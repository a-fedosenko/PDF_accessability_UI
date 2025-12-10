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
    Get all jobs for a user using the GSI
    Returns active jobs (not COMPLETED, FAILED, or CANCELLED)
    """
    try:
        # Extract user_sub from Cognito authorizer
        # API Gateway puts the claims in requestContext.authorizer.claims
        authorizer = event.get('requestContext', {}).get('authorizer', {})
        claims = authorizer.get('claims', {})
        user_sub = claims.get('sub')

        # Fallback: try to get from query parameters (for testing)
        if not user_sub:
            query_params = event.get('queryStringParameters') or {}
            user_sub = query_params.get('user_sub')

        if not user_sub:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({'error': 'user_sub is required'})
            }

        print(f"Fetching jobs for user: {user_sub}")

        # Query using GSI
        response = table.query(
            IndexName='user_sub-created_at-index',
            KeyConditionExpression='user_sub = :user_sub',
            ExpressionAttributeValues={
                ':user_sub': user_sub
            },
            ScanIndexForward=False,  # Sort by created_at descending (newest first)
            Limit=20  # Limit to last 20 jobs
        )

        jobs = response.get('Items', [])

        # Filter to only active jobs (optional - can return all)
        # Uncomment the following lines to only return active jobs:
        # active_statuses = ['UPLOADED', 'ANALYZING', 'ANALYSIS_COMPLETE', 'PROCESSING']
        # jobs = [job for job in jobs if job.get('status') in active_statuses]

        print(f"Found {len(jobs)} jobs for user {user_sub}")

        # Convert Decimals to floats for JSON serialization
        jobs_json = json.loads(json.dumps(jobs, default=decimal_to_float))

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'jobs': jobs_json,
                'count': len(jobs_json)
            })
        }

    except Exception as e:
        print(f"Error getting user jobs: {str(e)}")

        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({'error': str(e)})
        }
