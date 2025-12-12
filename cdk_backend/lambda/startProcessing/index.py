import json
import boto3
import os
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
lambda_client = boto3.client('lambda')
table_name = os.environ['JOBS_TABLE_NAME']
split_pdf_lambda = os.environ.get('SPLIT_PDF_LAMBDA_ARN')
table = dynamodb.Table(table_name)

def handler(event, context):
    """Start processing a job"""
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

        # Update job status to PROCESSING
        now = datetime.now(timezone.utc).isoformat()
        update_response = table.update_item(
            Key={'job_id': job_id},
            UpdateExpression='SET #status = :status, updated_at = :updated_at, processing_metadata = :metadata',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'PROCESSING',
                ':updated_at': now,
                ':metadata': {
                    's3_bucket': job.get('s3_bucket'),
                    's3_key': job.get('s3_key'),
                    'started_at': now
                }
            },
            ReturnValues='ALL_NEW'
        )

        updated_job = update_response['Attributes']

        # Trigger the PDF processing workflow by invoking SplitPDF Lambda
        if split_pdf_lambda:
            try:
                # SplitPDF Lambda expects S3 event format (it was designed for S3 triggers)
                # We need to construct a fake S3 event with the same structure
                s3_bucket = job.get('s3_bucket')
                s3_key = job.get('s3_key')

                split_payload = {
                    'Records': [
                        {
                            'eventVersion': '2.1',
                            'eventSource': 'aws:s3',
                            'awsRegion': 'us-east-2',
                            'eventName': 'ObjectCreated:Put',
                            's3': {
                                's3SchemaVersion': '1.0',
                                'bucket': {
                                    'name': s3_bucket,
                                    'arn': f'arn:aws:s3:::{s3_bucket}'
                                },
                                'object': {
                                    'key': s3_key,
                                    'size': int(job.get('file_size_bytes', 0))
                                }
                            }
                        }
                    ],
                    # Add job_id as a top-level field for Step Functions callback
                    'job_id': job_id,
                    'user_sub': user_sub
                }

                print(f"Invoking SplitPDF Lambda with S3 event format payload for key: {s3_key}")

                # Invoke SplitPDF Lambda asynchronously
                lambda_response = lambda_client.invoke(
                    FunctionName=split_pdf_lambda,
                    InvocationType='Event',  # Async invocation
                    Payload=json.dumps(split_payload)
                )

                print(f"SplitPDF Lambda invoked successfully: {lambda_response}")

            except Exception as lambda_error:
                print(f"Error invoking SplitPDF Lambda: {str(lambda_error)}")
                # Update job status to FAILED
                table.update_item(
                    Key={'job_id': job_id},
                    UpdateExpression='SET #status = :status, error_message = :error, updated_at = :updated_at',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': 'FAILED',
                        ':error': f'Failed to start processing: {str(lambda_error)}',
                        ':updated_at': datetime.now(timezone.utc).isoformat()
                    }
                )
                raise
        else:
            print("Warning: SPLIT_PDF_LAMBDA_ARN not configured")

        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({
                'message': 'Processing started',
                'job': updated_job
            }, default=str)
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
