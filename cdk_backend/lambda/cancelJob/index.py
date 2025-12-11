import json
import boto3
import os
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
table_name = os.environ['JOBS_TABLE_NAME']
table = dynamodb.Table(table_name)

def handler(event, context):
    """
    Cancel a job by updating its status to CANCELLED

    Expected request body:
    {
        "job_id": "test.pdf_20241209_123456_abc123"
    }

    Returns:
    - 200: Job successfully cancelled
    - 400: Missing job_id or invalid request
    - 403: User doesn't own this job
    - 404: Job not found
    - 500: Internal server error
    """

    try:
        # Parse request body
        if 'body' in event:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            body = event

        job_id = body.get('job_id')
        delete_file = body.get('delete_file', False)  # Optional: delete S3 file

        if not job_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({'error': 'Missing job_id in request body'})
            }

        # Get user_sub from Cognito authorizer
        user_sub = None
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            claims = event['requestContext']['authorizer'].get('claims', {})
            user_sub = claims.get('sub') or claims.get('cognito:username')

        if not user_sub:
            return {
                'statusCode': 403,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({'error': 'Unauthorized - missing user identity'})
            }

        # Get the job from DynamoDB
        response = table.get_item(Key={'job_id': job_id})

        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({'error': f'Job not found: {job_id}'})
            }

        job = response['Item']

        # Verify user owns this job
        if job.get('user_sub') != user_sub:
            return {
                'statusCode': 403,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({'error': 'Forbidden - you do not own this job'})
            }

        # Check if job is already in a terminal state
        current_status = job.get('status', '')
        if current_status in ['COMPLETED', 'FAILED', 'CANCELLED']:
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                'body': json.dumps({
                    'message': f'Job is already in terminal state: {current_status}',
                    'job': job
                })
            }

        # Update job status to CANCELLED
        now = datetime.now(timezone.utc).isoformat()
        update_response = table.update_item(
            Key={'job_id': job_id},
            UpdateExpression='SET #status = :status, updated_at = :updated_at',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':status': 'CANCELLED',
                ':updated_at': now
            },
            ReturnValues='ALL_NEW'
        )

        updated_job = update_response['Attributes']

        # Optionally delete the S3 file
        if delete_file and job.get('s3_key') and job.get('s3_bucket'):
            try:
                s3_client.delete_object(
                    Bucket=job['s3_bucket'],
                    Key=job['s3_key']
                )
                print(f"Deleted S3 file: s3://{job['s3_bucket']}/{job['s3_key']}")
            except Exception as s3_error:
                print(f"Warning: Could not delete S3 file: {str(s3_error)}")
                # Don't fail the cancellation if S3 delete fails

        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'POST,OPTIONS'
            },
            'body': json.dumps({
                'message': 'Job cancelled successfully',
                'job': updated_job
            }, default=str)
        }

    except Exception as e:
        print(f"Error cancelling job: {str(e)}")
        import traceback
        traceback.print_exc()

        return {
            'statusCode': 500,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'POST,OPTIONS'
            },
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }
