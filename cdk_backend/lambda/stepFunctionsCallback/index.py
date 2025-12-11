import json
import boto3
import os
from datetime import datetime, timezone
import re

dynamodb = boto3.resource('dynamodb')
table_name = os.environ['JOBS_TABLE_NAME']
table = dynamodb.Table(table_name)

def handler(event, context):
    """
    EventBridge callback when Step Functions execution completes.
    Updates DynamoDB job status to COMPLETED or FAILED.
    """
    try:
        print(f"Received event: {json.dumps(event)}")

        # Get Step Functions execution details
        detail = event.get('detail', {})
        status = detail.get('status')  # SUCCEEDED or FAILED
        execution_arn = detail.get('executionArn')
        output = detail.get('output')

        if not execution_arn:
            print("No execution ARN found in event")
            return {'statusCode': 400, 'body': 'No execution ARN'}

        # Extract job_id and s3_key from execution input
        input_str = detail.get('input', '{}')
        input_data = json.loads(input_str) if isinstance(input_str, str) else input_str
        job_id = input_data.get('job_id')
        s3_key = input_data.get('chunks', [{}])[0].get('s3_key') if 'chunks' in input_data else input_data.get('s3_key')

        if not job_id and not s3_key:
            print(f"No job_id or s3_key found in Step Functions input: {input_str}")
            return {'statusCode': 400, 'body': 'No job_id or s3_key in execution input'}

        # If no job_id, try to find it by scanning DynamoDB for matching s3_key
        if not job_id and s3_key:
            print(f"Trying to find job by s3_key: {s3_key}")
            try:
                # Scan for job with matching s3_key in processing_metadata
                response = table.scan(
                    FilterExpression='processing_metadata.s3_key = :s3_key',
                    ExpressionAttributeValues={':s3_key': s3_key},
                    Limit=1
                )
                if response.get('Items'):
                    job_id = response['Items'][0]['job_id']
                    print(f"Found job_id by s3_key: {job_id}")
                else:
                    print(f"No job found with s3_key: {s3_key}")
                    return {'statusCode': 404, 'body': 'Job not found'}
            except Exception as scan_error:
                print(f"Error scanning for job: {str(scan_error)}")
                return {'statusCode': 500, 'body': f'Error finding job: {str(scan_error)}'}

        print(f"Processing callback for job_id: {job_id}, status: {status}")

        # Parse output to get processed file location
        output_data = json.loads(output) if isinstance(output, str) else output
        processed_file_key = None

        # Extract processed filename from ParallelResults
        if 'ParallelResults' in output_data and len(output_data['ParallelResults']) > 0:
            result_str = output_data['ParallelResults'][0]
            # Extract filename from string like "Filename : COMPLIANT_xxx.pdf | ..."
            match = re.search(r'Filename\s*:\s*([^\s|]+)', result_str)
            if match:
                processed_filename = match.group(1)
                # Construct the S3 key
                s3_bucket = input_data.get('s3_bucket')
                original_key = input_data.get('s3_key', '')
                # The processed file is typically in a specific location
                # Based on the output, it seems to be in the root or uploads folder
                processed_file_key = f"uploads/{processed_filename}"
                print(f"Extracted processed file key: {processed_file_key}")

        # Update job status in DynamoDB
        now = datetime.now(timezone.utc).isoformat()

        if status == 'SUCCEEDED':
            update_expression = 'SET #status = :status, updated_at = :updated_at'
            expression_values = {
                ':status': 'COMPLETED',
                ':updated_at': now
            }

            if processed_file_key:
                update_expression += ', processed_s3_key = :processed_key'
                expression_values[':processed_key'] = processed_file_key

            table.update_item(
                Key={'job_id': job_id},
                UpdateExpression=update_expression,
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues=expression_values
            )
            print(f"Job {job_id} marked as COMPLETED")

        elif status == 'FAILED':
            error_msg = detail.get('cause', 'Step Functions execution failed')
            table.update_item(
                Key={'job_id': job_id},
                UpdateExpression='SET #status = :status, updated_at = :updated_at, error_message = :error',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': 'FAILED',
                    ':updated_at': now,
                    ':error': error_msg
                }
            )
            print(f"Job {job_id} marked as FAILED: {error_msg}")

        return {
            'statusCode': 200,
            'body': json.dumps({'message': f'Job {job_id} updated to {status}'})
        }

    except Exception as e:
        print(f"Error in callback handler: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
