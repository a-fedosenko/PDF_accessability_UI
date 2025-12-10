import json
import boto3
import os
from decimal import Decimal
from urllib.parse import unquote

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
    # Print entire event for debugging
    print("=== GET JOB LAMBDA INVOKED ===")
    print(f"Full event: {json.dumps(event, default=str)}")

    try:
        # Extract job_id from path parameters
        path_params = event.get('pathParameters') or {}
        job_id_raw = path_params.get('job_id')
        # URL decode the job_id (API Gateway doesn't decode path parameters)
        job_id = unquote(job_id_raw) if job_id_raw else None
        print(f"pathParameters: {path_params}")
        print(f"Raw job_id: {repr(job_id_raw)}")
        print(f"Decoded job_id: {repr(job_id)}")

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
        print(f"Job ID type: {type(job_id)}, Job ID repr: {repr(job_id)}")
        print(f"Job ID length: {len(job_id)}")

        # Get job from DynamoDB
        print(f"Querying DynamoDB with Key: {{'job_id': {repr(job_id)}}}")
        response = table.get_item(Key={'job_id': job_id})
        print(f"DynamoDB response: {response}")

        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({
                    'error': 'Job not found',
                    'job_id_received': job_id,
                    'job_id_length': len(job_id),
                    'job_id_repr': repr(job_id),
                    'user_sub': user_sub
                })
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
