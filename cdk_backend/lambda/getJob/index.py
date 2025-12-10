import json
import boto3
import os
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')

JOBS_TABLE_NAME = os.environ['JOBS_TABLE_NAME']

table = dynamodb.Table(JOBS_TABLE_NAME)

def decimal_to_float(obj):
    """Convert Decimal objects to float for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError

def handler(event, context):
    """
    Get a specific job by job_id
    Validates that the requesting user owns the job
    """
    try:
        # Extract job_id from path parameters
        path_params = event.get('pathParameters') or {}
        job_id = path_params.get('job_id')

        if not job_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({'error': 'job_id is required'})
            }

        # Extract user_sub from Cognito authorizer
        authorizer = event.get('requestContext', {}).get('authorizer', {})
        claims = authorizer.get('claims', {})
        user_sub = claims.get('sub')

        if not user_sub:
            return {
                'statusCode': 401,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({'error': 'Unauthorized'})
            }

        print(f"Fetching job {job_id} for user {user_sub}")

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

        # Validate that the user owns this job
        if job.get('user_sub') != user_sub:
            return {
                'statusCode': 403,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({'error': 'Access denied'})
            }

        # Convert Decimals to floats for JSON serialization
        job_json = json.loads(json.dumps(job, default=decimal_to_float))

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps(job_json)
        }

    except Exception as e:
        print(f"Error getting job: {str(e)}")

        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({'error': str(e)})
        }
