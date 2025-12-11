import json
import boto3
import os
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table_name = os.environ['JOBS_TABLE_NAME']
table = dynamodb.Table(table_name)

def handler(event, context):
    """Get all jobs for a user"""
    try:
        # Get user_sub from Cognito authorizer
        user_sub = None
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            claims = event['requestContext']['authorizer'].get('claims', {})
            user_sub = claims.get('sub') or claims.get('cognito:username')

        if not user_sub:
            return {
                'statusCode': 403,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Unauthorized'})
            }

        # Query using GSI
        response = table.query(
            IndexName='user_sub-created_at-index',
            KeyConditionExpression=Key('user_sub').eq(user_sub),
            ScanIndexForward=False  # Sort descending by created_at
        )

        jobs = response.get('Items', [])

        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'jobs': jobs}, default=str)
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
