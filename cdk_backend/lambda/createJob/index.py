import json
import boto3
import os
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
table_name = os.environ['JOBS_TABLE_NAME']
table = dynamodb.Table(table_name)

def handler(event, context):
    """Create a new job in DynamoDB"""
    try:
        if 'body' in event:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            body = event

        job_id = body.get('job_id')
        user_sub = body.get('user_sub')
        file_name = body.get('file_name')
        s3_key = body.get('s3_key')
        s3_bucket = body.get('s3_bucket')
        file_size_bytes = body.get('file_size_bytes', 0)

        if not all([job_id, user_sub, file_name, s3_key, s3_bucket]):
            return {
                'statusCode': 400,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Missing required fields'})
            }

        now = datetime.now(timezone.utc).isoformat()

        job_item = {
            'job_id': job_id,
            'user_sub': user_sub,
            'file_name': file_name,
            's3_key': s3_key,
            's3_bucket': s3_bucket,
            'file_size_bytes': file_size_bytes,
            'file_size_mb': round(file_size_bytes / (1024 * 1024), 2),
            'status': 'UPLOADED',
            'created_at': now,
            'updated_at': now
        }

        table.put_item(Item=job_item)

        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'message': 'Job created', 'job': job_item}, default=str)
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
