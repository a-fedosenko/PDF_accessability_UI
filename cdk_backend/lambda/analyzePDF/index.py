import json
import boto3
import os
from datetime import datetime, timezone
import PyPDF2
from io import BytesIO

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
table_name = os.environ['JOBS_TABLE_NAME']
table = dynamodb.Table(table_name)

# Adobe API pricing: 10 transactions per page
TRANSACTIONS_PER_PAGE = 10
YEARLY_QUOTA = 25000

def handler(event, context):
    """Analyze PDF complexity and estimate cost"""
    try:
        if 'body' in event:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            body = event

        job_id = body.get('job_id')

        if not job_id:
            return {
                'statusCode': 400,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Missing job_id'})
            }

        # Get user_sub from Cognito authorizer
        user_sub = None
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            claims = event['requestContext']['authorizer'].get('claims', {})
            user_sub = claims.get('sub') or claims.get('cognito:username')

        # Get the job
        response = table.get_item(Key={'job_id': job_id})

        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': f'Job not found: {job_id}'})
            }

        job = response['Item']

        # Verify user owns this job
        if user_sub and job.get('user_sub') != user_sub:
            return {
                'statusCode': 403,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Forbidden'})
            }

        # Update status to ANALYZING
        now = datetime.now(timezone.utc).isoformat()
        table.update_item(
            Key={'job_id': job_id},
            UpdateExpression='SET #status = :status, updated_at = :updated_at',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'ANALYZING',
                ':updated_at': now
            }
        )

        # Download and analyze PDF from S3
        s3_key = job.get('s3_key')
        s3_bucket = job.get('s3_bucket')

        try:
            pdf_object = s3_client.get_object(Bucket=s3_bucket, Key=s3_key)
            pdf_content = pdf_object['Body'].read()
            pdf_reader = PyPDF2.PdfReader(BytesIO(pdf_content))

            num_pages = len(pdf_reader.pages)

            # Estimate elements (simple heuristic)
            total_elements = 0
            for page in pdf_reader.pages:
                # Count text elements
                text = page.extract_text()
                # Rough estimate: lines + objects
                elements = len(text.split('\n')) + 10  # Base objects per page
                total_elements += elements

            avg_elements_per_page = total_elements / num_pages if num_pages > 0 else 0

            # Calculate cost estimate
            estimated_transactions = num_pages * TRANSACTIONS_PER_PAGE
            estimated_cost_percentage = (estimated_transactions / YEARLY_QUOTA) * 100

            # Determine complexity
            if avg_elements_per_page < 50:
                complexity = 'LOW'
            elif avg_elements_per_page < 150:
                complexity = 'MEDIUM'
            else:
                complexity = 'HIGH'

        except Exception as pdf_error:
            print(f"Error analyzing PDF: {str(pdf_error)}")
            # Fallback to basic estimates
            file_size_mb = job.get('file_size_mb', 1)
            num_pages = max(1, int(file_size_mb * 10))  # Rough estimate
            estimated_transactions = num_pages * TRANSACTIONS_PER_PAGE
            estimated_cost_percentage = (estimated_transactions / YEARLY_QUOTA) * 100
            complexity = 'MEDIUM'
            total_elements = num_pages * 100
            avg_elements_per_page = 100

        # Update job with analysis results
        update_response = table.update_item(
            Key={'job_id': job_id},
            UpdateExpression='SET #status = :status, num_pages = :pages, complexity = :complexity, '
                           'estimated_transactions = :transactions, estimated_cost_percentage = :cost_pct, '
                           'estimated_elements = :elements, avg_elements_per_page = :avg_elements, '
                           'updated_at = :updated_at',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'ANALYSIS_COMPLETE',
                ':pages': num_pages,
                ':complexity': complexity,
                ':transactions': estimated_transactions,
                ':cost_pct': round(estimated_cost_percentage, 2),
                ':elements': total_elements,
                ':avg_elements': round(avg_elements_per_page, 1),
                ':updated_at': datetime.now(timezone.utc).isoformat()
            },
            ReturnValues='ALL_NEW'
        )

        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({
                'message': 'Analysis complete',
                'job': update_response['Attributes']
            }, default=str)
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
