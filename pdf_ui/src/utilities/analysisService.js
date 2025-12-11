/**
 * Analysis Service
 * Handles communication with DynamoDB for PDF analysis results
 * and the Start Remediation API
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { StartProcessingEndpoint, PendingJobsTableName, region } from './constants';

/**
 * Poll DynamoDB for analysis results
 * @param {string} jobId - The job ID to check
 * @param {object} awsCredentials - AWS credentials for DynamoDB access
 * @param {number} maxAttempts - Maximum number of polling attempts (default: 30)
 * @param {number} intervalMs - Time between polling attempts in ms (default: 2000)
 * @returns {Promise<object>} Analysis results from DynamoDB
 */
export const pollForAnalysis = async (jobId, awsCredentials, maxAttempts = 30, intervalMs = 2000) => {
  if (!awsCredentials) {
    throw new Error('AWS credentials not available');
  }

  const dynamoClient = new DynamoDBClient({
    region,
    credentials: {
      accessKeyId: awsCredentials.accessKeyId,
      secretAccessKey: awsCredentials.secretAccessKey,
      sessionToken: awsCredentials.sessionToken,
    },
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const command = new GetItemCommand({
        TableName: PendingJobsTableName,
        Key: {
          job_id: { S: jobId }
        }
      });

      const response = await dynamoClient.send(command);

      if (response.Item) {
        // Convert DynamoDB format to regular object
        const analysis = {
          job_id: response.Item.job_id?.S,
          file_name: response.Item.file_name?.S,
          file_key: response.Item.file_key?.S,
          file_size_mb: parseFloat(response.Item.file_size_mb?.N || '0'),
          num_pages: parseInt(response.Item.num_pages?.N || '0', 10),
          estimated_elements: parseInt(response.Item.estimated_elements?.N || '0', 10),
          estimated_transactions: parseInt(response.Item.estimated_transactions?.N || '0', 10),
          avg_elements_per_page: parseFloat(response.Item.avg_elements_per_page?.N || '0'),
          complexity: response.Item.complexity?.S || 'unknown',
          estimated_cost_percentage: parseFloat(response.Item.estimated_cost_percentage?.N || '0'),
          status: response.Item.status?.S || 'pending_approval',
          created_at: response.Item.created_at?.S,
        };

        console.log('Analysis found:', analysis);
        return analysis;
      }

      // If not found yet, wait and try again
      console.log(`Attempt ${attempt + 1}/${maxAttempts}: Analysis not ready yet, waiting...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));

    } catch (error) {
      console.error(`Error polling for analysis (attempt ${attempt + 1}):`, error);

      // If this is the last attempt, throw the error
      if (attempt === maxAttempts - 1) {
        throw new Error(`Failed to retrieve analysis after ${maxAttempts} attempts: ${error.message}`);
      }

      // Otherwise, wait and retry
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Analysis not found after ${maxAttempts} attempts`);
};

/**
 * Start remediation for an approved PDF
 * @param {string} jobId - The job ID to start processing
 * @param {string} idToken - User's ID token for authorization
 * @returns {Promise<object>} API response
 */
export const startRemediation = async (jobId, idToken) => {
  try {
    const response = await fetch(StartProcessingEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        job_id: jobId,
        user_approved: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `API error: ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('Error starting remediation:', error);
    throw error;
  }
};

/**
 * Get the complexity color for UI display
 * @param {string} complexity - Complexity level (simple, moderate, complex, very_complex)
 * @returns {string} Color code
 */
export const getComplexityColor = (complexity) => {
  switch (complexity?.toUpperCase()) {
    case 'LOW':
      return '#28a745'; // Green
    case 'MEDIUM':
      return '#ffc107'; // Yellow
    case 'HIGH':
      return '#dc3545'; // Red
    // Legacy support for old complexity values
    case 'SIMPLE':
      return '#28a745'; // Green
    case 'MODERATE':
      return '#ffc107'; // Yellow
    case 'COMPLEX':
      return '#fd7e14'; // Orange
    case 'VERY_COMPLEX':
      return '#dc3545'; // Red
    default:
      return '#6c757d'; // Gray
  }
};

/**
 * Get the complexity display name
 * @param {string} complexity - Complexity level
 * @returns {string} Display name
 */
export const getComplexityDisplayName = (complexity) => {
  switch (complexity?.toUpperCase()) {
    case 'LOW':
      return 'Low';
    case 'MEDIUM':
      return 'Medium';
    case 'HIGH':
      return 'High';
    // Legacy support for old complexity values
    case 'SIMPLE':
      return 'Simple';
    case 'MODERATE':
      return 'Moderate';
    case 'COMPLEX':
      return 'Complex';
    case 'VERY_COMPLEX':
      return 'Very Complex';
    default:
      return 'Unknown';
  }
};
