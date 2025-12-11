import json
import boto3
import os
from urllib.parse import unquote

dynamodb = boto3.resource('dynamodb')
table_name = os.environ['JOBS_TABLE_NAME']
table = dynamodb.Table(table_name)

def handler(event, context):
    """Get a specific job by ID"""
    try:
        # Get job_id from path parameters
        job_id = event.get('pathParameters', {}).get('job_id')

        if not job_id:
            return {
                'statusCode': 400,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Missing job_id'})
            }

        # URL decode the job_id
        job_id = unquote(job_id)

        response = table.get_item(Key={'job_id': job_id})

        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': f'Job not found: {job_id}'})
            }

        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps(response['Item'], default=str)
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
