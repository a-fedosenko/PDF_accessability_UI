import json
import boto3
import os
from datetime import datetime, timedelta
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

JOBS_TABLE_NAME = os.environ['JOBS_TABLE_NAME']
PDF_BUCKET_NAME = os.environ['PDF_BUCKET_NAME']

table = dynamodb.Table(JOBS_TABLE_NAME)

def handler(event, context):
    """
    Create a job record in DynamoDB after file upload
    This can be triggered by S3 event or API call
    """
    try:
        # Handle both S3 event and API Gateway event
        if 'Records' in event:
            # S3 event trigger
            record = event['Records'][0]
            s3_bucket = record['s3']['bucket']['name']
            s3_key = record['s3']['object']['key']

            # Extract user_sub and file name from S3 key
            # Expected format: uploads/{user_sub}/{job_id}.pdf
            parts = s3_key.split('/')
            if len(parts) != 3 or parts[0] != 'uploads':
                print(f"Invalid S3 key format: {s3_key}")
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': 'Invalid S3 key format'})
                }

            user_sub = parts[1]
            job_id_with_ext = parts[2]
            job_id = job_id_with_ext.replace('.pdf', '')

            # Get file size from S3
            s3_response = s3_client.head_object(Bucket=s3_bucket, Key=s3_key)
            file_size_bytes = s3_response['ContentLength']

            # Extract original file name from job_id (format: filename_timestamp)
            file_name = job_id.rsplit('_', 1)[0] + '.pdf'

            # User email would need to come from Cognito - skip for S3 trigger
            user_email = None

        else:
            # API Gateway event
            body = json.loads(event['body']) if isinstance(event.get('body'), str) else event.get('body', {})

            job_id = body.get('job_id')
            user_sub = body.get('user_sub')
            user_email = body.get('user_email')
            file_name = body.get('file_name')
            s3_key = body.get('s3_key')
            s3_bucket = body.get('s3_bucket', PDF_BUCKET_NAME)

            if not all([job_id, user_sub, file_name, s3_key]):
                return {
                    'statusCode': 400,
                    'headers': {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                    'body': json.dumps({'error': 'Missing required fields'})
                }

            # Get file size from S3
            try:
                s3_response = s3_client.head_object(Bucket=s3_bucket, Key=s3_key)
                file_size_bytes = s3_response['ContentLength']
            except Exception as e:
                print(f"Error getting file size: {str(e)}")
                file_size_bytes = body.get('file_size_bytes', 0)

        # Calculate file size in MB
        file_size_mb = round(file_size_bytes / (1024 * 1024), 2)

        # Calculate expiration (7 days from now)
        expires_at = int((datetime.utcnow() + timedelta(days=7)).timestamp())

        # Create job record
        job_item = {
            'job_id': job_id,
            'user_sub': user_sub,
            'status': 'UPLOADED',
            'file_name': file_name,
            'file_size_mb': Decimal(str(file_size_mb)),
            'file_size_bytes': file_size_bytes,
            's3_key': s3_key,
            's3_bucket': s3_bucket or PDF_BUCKET_NAME,
            'created_at': datetime.utcnow().isoformat() + 'Z',
            'updated_at': datetime.utcnow().isoformat() + 'Z',
            'expires_at': expires_at,
        }

        # Add email if available
        if user_email:
            job_item['user_email'] = user_email

        # Store in DynamoDB
        table.put_item(Item=job_item)

        print(f"Job created: {job_id} for user {user_sub}")

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'message': 'Job created successfully',
                'job_id': job_id,
                'status': 'UPLOADED',
                'file_size_mb': float(file_size_mb)
            })
        }

    except Exception as e:
        print(f"Error creating job: {str(e)}")

        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({'error': str(e)})
        }
