import json
import boto3
import os
from datetime import datetime, timedelta
from decimal import Decimal
import PyPDF2
from io import BytesIO

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

JOBS_TABLE_NAME = os.environ['JOBS_TABLE_NAME']
PDF_BUCKET_NAME = os.environ['PDF_BUCKET_NAME']

table = dynamodb.Table(JOBS_TABLE_NAME)

def handler(event, context):
    """
    Analyze PDF file and store results in DynamoDB
    """
    try:
        # Parse request body
        body = json.loads(event['body']) if isinstance(event.get('body'), str) else event.get('body', {})
        job_id = body.get('job_id')

        if not job_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({'error': 'job_id is required'})
            }

        # Get job from DynamoDB
        response = table.get_item(Key={'job_id': job_id})
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({'error': 'Job not found'})
            }

        job = response['Item']
        s3_key = job['s3_key']

        # Update status to ANALYZING
        table.update_item(
            Key={'job_id': job_id},
            UpdateExpression='SET #status = :status, updated_at = :updated_at',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'ANALYZING',
                ':updated_at': datetime.utcnow().isoformat() + 'Z'
            }
        )

        # Download PDF from S3
        s3_response = s3_client.get_object(Bucket=PDF_BUCKET_NAME, Key=s3_key)
        pdf_content = s3_response['Body'].read()

        # Analyze PDF
        pdf_reader = PyPDF2.PdfReader(BytesIO(pdf_content))
        num_pages = len(pdf_reader.pages)

        # Estimate elements (average 30 elements per page)
        avg_elements_per_page = 30
        estimated_elements = num_pages * avg_elements_per_page

        # Calculate transactions (10 elements per transaction)
        estimated_transactions = estimated_elements // 10

        # Determine complexity based on page count
        if num_pages < 10:
            complexity = 'simple'
        elif num_pages < 50:
            complexity = 'moderate'
        else:
            complexity = 'complex'

        # Estimate cost percentage (assuming 25000 quota limit)
        quota_limit = 25000
        estimated_cost_percentage = (estimated_transactions / quota_limit) * 100

        # Update DynamoDB with analysis results
        table.update_item(
            Key={'job_id': job_id},
            UpdateExpression='''SET #status = :status,
                                   num_pages = :num_pages,
                                   estimated_elements = :estimated_elements,
                                   estimated_transactions = :estimated_transactions,
                                   avg_elements_per_page = :avg_elements_per_page,
                                   complexity = :complexity,
                                   estimated_cost_percentage = :estimated_cost_percentage,
                                   updated_at = :updated_at''',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'ANALYSIS_COMPLETE',
                ':num_pages': num_pages,
                ':estimated_elements': estimated_elements,
                ':estimated_transactions': estimated_transactions,
                ':avg_elements_per_page': avg_elements_per_page,
                ':complexity': complexity,
                ':estimated_cost_percentage': Decimal(str(round(estimated_cost_percentage, 2))),
                ':updated_at': datetime.utcnow().isoformat() + 'Z'
            }
        )

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'message': 'Analysis complete',
                'job_id': job_id,
                'num_pages': num_pages,
                'estimated_elements': estimated_elements,
                'estimated_transactions': estimated_transactions,
                'complexity': complexity,
                'estimated_cost_percentage': float(estimated_cost_percentage)
            })
        }

    except Exception as e:
        print(f"Error analyzing PDF: {str(e)}")

        # Update job status to FAILED
        if 'job_id' in locals():
            try:
                table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression='SET #status = :status, error_message = :error, updated_at = :updated_at',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': 'FAILED',
                        ':error': str(e),
                        ':updated_at': datetime.utcnow().isoformat() + 'Z'
                    }
                )
            except Exception as update_error:
                print(f"Error updating job status: {str(update_error)}")

        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({'error': str(e)})
        }
