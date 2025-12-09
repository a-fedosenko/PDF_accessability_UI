# Frontend Pre-Processing Analysis Implementation

## Overview

The frontend has been successfully updated to implement the **two-step PDF processing workflow** with pre-processing analysis. This allows users to see estimated Adobe API costs before starting the remediation process.

## What Was Implemented

### 1. New Components

#### **AnalysisResultsSection.jsx**
- Displays PDF analysis results to the user
- Shows file size, page count, complexity level
- Estimates Adobe API transactions and quota usage
- Provides "Start Remediation" and "Cancel" buttons
- **Location**: `/pdf_ui/src/components/AnalysisResultsSection.jsx`

#### **AnalysisResultsSection.css**
- Styling for the analysis results display
- Responsive design with gradient cost analysis section
- Color-coded complexity indicators
- **Location**: `/pdf_ui/src/components/AnalysisResultsSection.css`

### 2. New Utilities

#### **analysisService.js**
Contains utility functions for:
- **`pollForAnalysis()`**: Polls DynamoDB for analysis results
- **`startRemediation()`**: Calls the API to start processing
- **`getComplexityColor()`**: Returns color for complexity level
- **`getComplexityDisplayName()`**: Returns display name for complexity
- **Location**: `/pdf_ui/src/utilities/analysisService.js`

### 3. Updated Files

#### **constants.jsx**
Added new configuration:
```javascript
export const StartRemediationAPI = process.env.REACT_APP_START_REMEDIATION_API;
export const PendingJobsTableName = process.env.REACT_APP_PENDING_JOBS_TABLE;
```

#### **UploadSection.jsx**
- Changed upload prefix from `pdf/` to `pdf-upload/`
- Generates `jobId` for analysis tracking
- Passes `jobId` to parent component
- **Modified line 265**: `const keyPrefix = selectedFormat === 'html' ? 'uploads/' : 'pdf-upload/';`

#### **MainApp.js**
Added complete workflow orchestration:
- New state variables for analysis data
- `handleUploadComplete()` now starts analysis polling
- `handleStartRemediation()` transitions to processing
- `handleCancelAnalysis()` returns to upload
- New page state: `analyzing` and `analysis-results`
- Renders `AnalysisResultsSection` component

### 4. Configuration Files

#### **.env.example**
Documents all required environment variables including:
```
REACT_APP_START_REMEDIATION_API=https://your-api-url/start-remediation
REACT_APP_PENDING_JOBS_TABLE=pdf-accessibility-pending-jobs
```

## New Workflow

### Before (Immediate Processing):
```
1. User uploads PDF
2. File uploaded to S3 (pdf/ prefix)
3. Processing starts immediately
4. User waits for result
```

### After (Analysis First):
```
1. User uploads PDF
2. File uploaded to S3 (pdf-upload/ prefix)
3. Show "Analyzing..." spinner
4. Poll DynamoDB for analysis results
5. Display analysis to user:
   - File size, pages, complexity
   - Estimated transactions
   - Cost as % of quota
6. User clicks "Start Remediation" or "Cancel"
7. If approved: API call → file copied to pdf/ → processing starts
8. User waits for result
```

## Page States

The application now has the following page states:

| State | Description | Component Shown |
|-------|-------------|----------------|
| `upload` | Initial state, ready for file selection | UploadSection |
| `analyzing` | Waiting for analysis results from backend | Loading spinner |
| `analysis-results` | Showing analysis to user | AnalysisResultsSection |
| `processing` | File is being processed | ProcessingContainer |
| `results` | Processing complete, show download | ResultsContainer |

## Environment Variables Required

Add these to your `.env` file:

```bash
# Get this from CloudFormation outputs after deploying backend
REACT_APP_START_REMEDIATION_API=https://xxxxxxxxxx.execute-api.us-east-2.amazonaws.com/prod/start-remediation

# DynamoDB table name (default value used if not set)
REACT_APP_PENDING_JOBS_TABLE=pdf-accessibility-pending-jobs
```

## How to Get API URL

After deploying the backend CDK stack, get the API URL:

```bash
# Method 1: From CloudFormation outputs
aws cloudformation describe-stacks --stack-name PDFAccessibility \
  --query 'Stacks[0].Outputs[?OutputKey==`APIStartRemediationEndpoint`].OutputValue' \
  --output text

# Method 2: From CDK deployment output
# Look for: PDFAccessibility.APIStartRemediationEndpoint = https://...
```

## Complexity Indicators

The frontend displays complexity with color coding:

| Complexity | Color | Description |
|-----------|-------|-------------|
| Simple | 🟢 Green | < 5 elements per page |
| Moderate | 🟡 Yellow | 5-8 elements per page |
| Complex | 🟠 Orange | 8-15 elements per page |
| Very Complex | 🔴 Red | > 15 elements per page |

## Analysis Polling

The frontend polls DynamoDB for analysis results:
- **Max attempts**: 30 (default)
- **Interval**: 2 seconds
- **Total wait time**: Up to 60 seconds
- **Timeout behavior**: Returns to upload page with error

You can adjust these in `analysisService.js`:
```javascript
pollForAnalysis(jobId, awsCredentials, maxAttempts=30, intervalMs=2000)
```

## Dependencies Required

The implementation uses existing dependencies:
- `@aws-sdk/client-dynamodb` - For DynamoDB polling
- `@mui/material` - For UI components
- `framer-motion` - For animations
- `react-oidc-context` - For authentication

No new packages need to be installed!

## Testing the Implementation

### 1. Build the Frontend

```bash
cd /home/andreyf/projects/PDF_accessability_UI/pdf_ui
npm install
npm run build
```

### 2. Update Environment Variables

Create or update `.env`:
```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Test Locally

```bash
npm start
```

### 4. Test Workflow

1. **Upload a PDF**: Select a test PDF file
2. **Wait for analysis**: Should see "Analyzing..." spinner
3. **View results**: Analysis card should appear with:
   - File information
   - Complexity indicator
   - Estimated cost
4. **Start or Cancel**:
   - Click "Start Remediation" to proceed
   - Click "Cancel" to return to upload
5. **Monitor processing**: Existing flow should work normally

## Error Handling

The implementation includes comprehensive error handling:

| Error Scenario | Behavior |
|---------------|----------|
| Analysis timeout | Returns to upload with error message |
| DynamoDB permission error | Shows error snackbar |
| API call failure | Shows error, allows retry |
| Network error | Shows error message with details |

## Backward Compatibility

The implementation maintains backward compatibility:
- **HTML format**: Skips analysis, goes straight to processing
- **Existing processing flow**: Unchanged after analysis approval
- **Upload quotas**: Still enforced before upload

## Files Modified Summary

✅ **New Files Created** (6):
1. `/pdf_ui/src/components/AnalysisResultsSection.jsx`
2. `/pdf_ui/src/components/AnalysisResultsSection.css`
3. `/pdf_ui/src/utilities/analysisService.js`
4. `/pdf_ui/.env.example`
5. `/FRONTEND_PREPROCESS_IMPLEMENTATION.md` (this file)

✅ **Files Modified** (3):
1. `/pdf_ui/src/utilities/constants.jsx` - Added API endpoints
2. `/pdf_ui/src/components/UploadSection.jsx` - Changed upload prefix
3. `/pdf_ui/src/MainApp.js` - Added workflow orchestration

## Deployment Steps

### Option 1: Manual Deployment

```bash
cd /home/andreyf/projects/PDF_accessability_UI/pdf_ui

# Install dependencies (if needed)
npm install

# Build the application
npm run build

# Deploy to S3 (adjust bucket name)
aws s3 sync build/ s3://your-frontend-bucket/ --delete

# Invalidate CloudFront cache (if using CloudFront)
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

### Option 2: Use Deployment Script

```bash
cd /home/andreyf/projects/PDF_accessability_UI

# Run the deployment script
./deploy-frontend.sh
```

## Troubleshooting

### Issue: Analysis never completes

**Check:**
1. Backend PDF Analyzer Lambda is deployed
2. S3 event notification is configured for `pdf-upload/` prefix
3. Lambda has permissions to write to DynamoDB
4. Check Lambda CloudWatch logs:
   ```bash
   aws logs tail /aws/lambda/PDFAccessibility-PDFAnalyzer-XXXXX --follow
   ```

### Issue: "Failed to retrieve analysis" error

**Check:**
1. DynamoDB table `pdf-accessibility-pending-jobs` exists
2. Frontend has correct AWS credentials (from Cognito)
3. Credentials have DynamoDB read permissions
4. Check browser console for detailed error

### Issue: "Start Remediation" button doesn't work

**Check:**
1. API Gateway endpoint is correct in `.env`
2. API has CORS enabled
3. User's ID token is valid
4. Check Network tab in browser DevTools for API response

### Issue: File doesn't start processing after approval

**Check:**
1. Start Remediation Lambda successfully copied file
2. File appears in `pdf/` prefix in S3
3. Split PDF Lambda is triggered by S3 event
4. Check Start Remediation Lambda logs

## Next Steps

1. ✅ Frontend implementation complete
2. 🔲 Deploy frontend with updated code
3. 🔲 Update `.env` with actual API URL
4. 🔲 Test end-to-end workflow
5. 🔲 Monitor user feedback
6. 🔲 Adjust polling intervals if needed

## Support

For issues or questions:
1. Check browser console for errors
2. Check Lambda CloudWatch logs
3. Verify environment variables
4. Test API endpoint with curl
5. Review this documentation

## Related Documentation

- [Backend Implementation](../PDF_Accessibility/PREPROCESS_ANALYSIS_IMPLEMENTATION.md)
- [Deployment Guide](../PDF_Accessibility/DEPLOYMENT_GUIDE_PREPROCESS.md)
- [Quota Monitoring](../PDF_Accessibility/QUOTA_MONITORING.md)
- [Adobe Monitoring](../PDF_Accessibility/ADOBE_MONITORING.md)
