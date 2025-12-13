import json
import boto3
import os
from urllib.parse import unquote

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
table_name = os.environ['JOBS_TABLE_NAME']
pdf_bucket = os.environ.get('PDF_BUCKET', '')

table = dynamodb.Table(table_name)

def handler(event, context):
    """
    Delete a job and optionally clean up associated S3 files.

    Expected path parameter:
    - job_id (from URL path)

    Optional request body:
    {
        "cleanup_s3": true  // Default: true
    }

    Returns:
    - 200: Job successfully deleted
    - 400: Missing job_id or invalid request
    - 403: User doesn't own this job
    - 404: Job not found
    - 500: Internal server error
    """

    try:
        # Get job_id from path parameters
        job_id = event.get('pathParameters', {}).get('job_id')

        if not job_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                    'Access-Control-Allow-Methods': 'DELETE,OPTIONS'
                },
                'body': json.dumps({'error': 'Missing job_id in path'})
            }

        # URL decode the job_id
        job_id = unquote(job_id)

        # Parse request body for options
        cleanup_s3 = True  # Default to cleaning up S3 files
        if 'body' in event and event['body']:
            try:
                body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
                cleanup_s3 = body.get('cleanup_s3', True)
            except json.JSONDecodeError:
                # If body parsing fails, use default
                pass

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
                    'Access-Control-Allow-Methods': 'DELETE,OPTIONS'
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
                    'Access-Control-Allow-Methods': 'DELETE,OPTIONS'
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
                    'Access-Control-Allow-Methods': 'DELETE,OPTIONS'
                },
                'body': json.dumps({'error': 'Forbidden - you do not own this job'})
            }

        deleted_files = []
        s3_errors = []

        # Clean up S3 files if requested
        if cleanup_s3 and pdf_bucket:
            s3_keys_to_delete = []

            # 1. Original uploaded file (pdf/filename.pdf or pdf/{job_id}.pdf)
            if job.get('s3_key'):
                s3_keys_to_delete.append(job['s3_key'])

            # 2. Processed result file (result/COMPLIANT_filename.pdf)
            if job.get('processed_s3_key'):
                s3_keys_to_delete.append(job['processed_s3_key'])

            # 3. Analysis report (temp/{job_id}_accessibility_report.json)
            # Extract base filename from s3_key
            if job.get('s3_key'):
                base_filename = job['s3_key'].split('/')[-1].replace('.pdf', '')
                analysis_report_key = f"temp/{base_filename}_accessibility_report.json"
                s3_keys_to_delete.append(analysis_report_key)

            # 4. Check for chunked files (pdf/{filename}_chunk_*.pdf)
            # We'll use list_objects_v2 to find any chunk files
            if job.get('s3_key'):
                base_key = job['s3_key'].replace('.pdf', '')
                try:
                    chunk_response = s3_client.list_objects_v2(
                        Bucket=pdf_bucket,
                        Prefix=f"{base_key}_chunk_"
                    )
                    if 'Contents' in chunk_response:
                        for obj in chunk_response['Contents']:
                            s3_keys_to_delete.append(obj['Key'])
                except Exception as list_error:
                    print(f"Warning: Could not list chunk files: {str(list_error)}")

            # Delete all identified S3 files
            for s3_key in s3_keys_to_delete:
                try:
                    s3_client.delete_object(
                        Bucket=pdf_bucket,
                        Key=s3_key
                    )
                    deleted_files.append(s3_key)
                    print(f"Deleted S3 file: s3://{pdf_bucket}/{s3_key}")
                except s3_client.exceptions.NoSuchKey:
                    # File doesn't exist, that's okay
                    print(f"S3 file not found (already deleted): {s3_key}")
                except Exception as s3_error:
                    error_msg = f"Failed to delete {s3_key}: {str(s3_error)}"
                    s3_errors.append(error_msg)
                    print(f"Warning: {error_msg}")
                    # Continue deleting other files even if one fails

        # Delete the job from DynamoDB
        table.delete_item(Key={'job_id': job_id})
        print(f"Deleted job from DynamoDB: {job_id}")

        # Prepare response
        response_body = {
            'success': True,
            'message': 'Job deleted successfully',
            'job_id': job_id,
            'deleted_files': deleted_files
        }

        if s3_errors:
            response_body['s3_warnings'] = s3_errors

        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'DELETE,OPTIONS'
            },
            'body': json.dumps(response_body, default=str)
        }

    except Exception as e:
        print(f"Error deleting job: {str(e)}")
        import traceback
        traceback.print_exc()

        return {
            'statusCode': 500,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'DELETE,OPTIONS'
            },
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }
