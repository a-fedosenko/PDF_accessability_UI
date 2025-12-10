import json
import boto3
import os
from datetime import datetime
from urllib.parse import unquote

dynamodb = boto3.resource('dynamodb')

JOBS_TABLE_NAME = os.environ['JOBS_TABLE_NAME']

table = dynamodb.Table(JOBS_TABLE_NAME)

def handler(event, context):
    """
    Start processing a PDF file
    This updates the job status to PROCESSING and triggers the remediation workflow
    """
    try:
        # Parse request body
        body = json.loads(event['body']) if isinstance(event.get('body'), str) else event.get('body', {})
        job_id_raw = body.get('job_id')
        # URL decode the job_id in case it's encoded
        job_id = unquote(job_id_raw) if job_id_raw else None

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

        # Validate job status (should be UPLOADED or ANALYSIS_COMPLETE)
        if job['status'] not in ['UPLOADED', 'ANALYSIS_COMPLETE']:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({
                    'error': f"Cannot start processing. Current status: {job['status']}"
                })
            }

        # Update status to PROCESSING
        table.update_item(
            Key={'job_id': job_id},
            UpdateExpression='SET #status = :status, updated_at = :updated_at',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'PROCESSING',
                ':updated_at': datetime.utcnow().isoformat() + 'Z'
            }
        )

        # NOTE: Here you would trigger the actual processing workflow
        # This could be:
        # - Invoking another Lambda function
        # - Starting a Step Functions execution
        # - Sending a message to SQS queue
        # - Triggering EventBridge event
        #
        # For now, this is a placeholder that just updates the status.
        # The actual remediation logic would be triggered here.
        #
        # Example for EventBridge:
        # events_client = boto3.client('events')
        # events_client.put_events(
        #     Entries=[{
        #         'Source': 'pdf-accessibility',
        #         'DetailType': 'StartProcessing',
        #         'Detail': json.dumps({
        #             'job_id': job_id,
        #             's3_key': job['s3_key'],
        #             's3_bucket': job['s3_bucket'],
        #             'user_sub': job['user_sub']
        #         })
        #     }]
        # )

        print(f"Processing started for job: {job_id}")
        print(f"S3 Key: {job['s3_key']}")
        print(f"User: {job['user_sub']}")

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'message': 'Processing started',
                'job_id': job_id,
                'status': 'PROCESSING'
            })
        }

    except Exception as e:
        print(f"Error starting processing: {str(e)}")

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
