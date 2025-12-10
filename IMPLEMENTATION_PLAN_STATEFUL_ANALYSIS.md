# Implementation Plan: Stateful PDF Analysis & Processing System

## Overview
Transform the PDF accessibility application from a stateless to a stateful architecture where DynamoDB serves as the single source of truth for all job states. This enables session persistence, manual analysis triggers, and recovery from page reloads.

## Current Problems
1. Page reload destroys session → User loses uploaded file and processing state
2. Analysis starts automatically on upload → No user control
3. No way to track job status across sessions
4. Frontend holds all state → Not persistent

## Solution Architecture

### Core Principle
**DynamoDB as Single Source of Truth**
- All job states stored in DynamoDB
- UI is a view layer that reflects backend state
- On page load: Query DynamoDB for user's active jobs
- User can reload anytime and resume from current state

### File Storage Strategy: **Option A (Single Location)**
- All uploaded files → `uploads/{user_sub}/{job_id}.pdf`
- DynamoDB tracks status, not file location changes
- Simpler, cleaner, more maintainable
- No file moving between prefixes

---

## Job Lifecycle States

### DynamoDB Job States
```
1. UPLOADED          → File uploaded, waiting for user action
2. ANALYZING         → User clicked "Check File", analysis in progress
3. ANALYSIS_COMPLETE → Analysis done, awaiting user decision (approve/cancel)
4. PROCESSING        → User clicked "Start Processing", remediation in progress
5. COMPLETED         → Processing done, file ready for download
6. FAILED            → Error occurred during processing
7. CANCELLED         → User cancelled the job
```

### DynamoDB Schema
**Table Name:** `pdf-accessibility-jobs`

**Primary Key:**
- `job_id` (String, Partition Key)

**Global Secondary Index:**
- `user_sub-created_at-index`
  - Partition Key: `user_sub` (String)
  - Sort Key: `created_at` (String, ISO timestamp)

**Attributes:**
```json
{
  "job_id": "filename_20250110T123456",
  "user_sub": "cognito-user-sub-id",
  "user_email": "user@example.com",
  "status": "UPLOADED",
  "file_name": "original_document.pdf",
  "file_size_mb": 15.2,
  "file_size_bytes": 15925248,
  "s3_key": "uploads/user_sub/job_id.pdf",
  "s3_bucket": "pdf-bucket-name",

  // Analysis results (populated after ANALYZING → ANALYSIS_COMPLETE)
  "num_pages": 150,
  "estimated_elements": 4500,
  "estimated_transactions": 450,
  "avg_elements_per_page": 30,
  "complexity": "complex",
  "estimated_cost_percentage": 1.8,

  // Processing results (populated after PROCESSING → COMPLETED)
  "processed_s3_key": "processed/user_sub/job_id_remediated.pdf",
  "processing_time_seconds": 180,
  "processing_completed_at": "2025-01-10T12:45:00Z",

  // Error tracking
  "error_message": "Error description if FAILED",
  "retry_count": 0,

  // Timestamps
  "created_at": "2025-01-10T12:30:00Z",
  "updated_at": "2025-01-10T12:35:00Z",
  "expires_at": 1736524800  // TTL: 7 days from creation
}
```

**TTL Configuration:**
- Enable TTL on `expires_at` attribute
- Automatically delete completed/failed jobs after 7 days

---

## User Flow

### 1. File Upload
**User Action:** Uploads PDF file

**Backend:**
1. Upload file to S3: `uploads/{user_sub}/{job_id}.pdf`
2. Create DynamoDB record with `status = "UPLOADED"`
3. Return `job_id` to frontend

**Frontend Display:**
- File name
- File size (MB)
- **Warning** if size > 10MB (red, informative):
  - "⚠ Large file detected (15.2 MB). Processing may take longer and consume more quota."
- Two action buttons:
  - **"Check File"** - Trigger analysis
  - **"Start Processing"** - Skip analysis, go straight to processing

### 2. Manual Analysis (Optional)
**User Action:** Clicks "Check File"

**Backend:**
1. Frontend calls: `POST /api/analyze-file` with `job_id`
2. API Gateway → Lambda function
3. Lambda:
   - Updates DynamoDB: `status = "ANALYZING"`
   - Downloads PDF from S3
   - Analyzes: page count, element estimation, complexity
   - Writes results to DynamoDB
   - Updates: `status = "ANALYSIS_COMPLETE"`

**Frontend Display:**
- Show spinner: "Analyzing your PDF..."
- Poll DynamoDB every 2 seconds for status change
- When `ANALYSIS_COMPLETE`:
  - Display analysis results:
    - Pages: 150
    - Estimated Elements: 4,500
    - Estimated Transactions: 450
    - Complexity: Complex
    - Estimated Cost: 1.8% of quota
  - Two action buttons:
    - **"Start Processing"** - Proceed with remediation
    - **"Cancel"** - Cancel job, return to upload

### 3. Start Processing
**User Action:** Clicks "Start Processing" (with or without prior analysis)

**Backend:**
1. Frontend calls: `POST /api/start-processing` with `job_id`
2. API Gateway → Lambda function
3. Lambda:
   - Updates DynamoDB: `status = "PROCESSING"`
   - Triggers existing remediation workflow
   - On completion:
     - Uploads processed file to S3
     - Updates DynamoDB: `status = "COMPLETED"`
     - Stores `processed_s3_key`, `processing_time_seconds`

**Frontend Display:**
- Show spinner: "Processing your PDF..."
- Poll DynamoDB every 3-5 seconds for status
- When `COMPLETED`: Show download section

### 4. Page Reload / Session Recovery
**User Action:** Reloads page or returns to app

**Backend:**
1. On component mount, frontend calls: `GET /api/my-jobs?user_sub={sub}`
2. API returns all active jobs (status not COMPLETED/FAILED/CANCELLED)
3. Most recent active job is displayed

**Frontend Display Based on Status:**
- `UPLOADED` → Show file info + "Check File" + "Start Processing" buttons
- `ANALYZING` → Show "Analyzing..." spinner + continue polling
- `ANALYSIS_COMPLETE` → Show analysis results + decision buttons
- `PROCESSING` → Show "Processing..." spinner + continue polling
- `COMPLETED` → Show download section
- `FAILED` → Show error message + "Try Again" button

---

## Backend Components to Implement

### 1. DynamoDB Table
**Resource:** `pdf-accessibility-jobs`

**CDK Implementation:**
```typescript
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

const jobsTable = new dynamodb.Table(this, 'PDFJobsTable', {
  tableName: 'pdf-accessibility-jobs',
  partitionKey: { name: 'job_id', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expires_at',
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// GSI for querying user's jobs
jobsTable.addGlobalSecondaryIndex({
  indexName: 'user_sub-created_at-index',
  partitionKey: { name: 'user_sub', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

**CDK Output:**
```typescript
new cdk.CfnOutput(this, 'JobsTableName', {
  value: jobsTable.tableName,
  description: 'DynamoDB table for job tracking',
});
```

### 2. Lambda Function: Analyze PDF
**Trigger:** API Gateway (manual, not S3 event)

**Function:** `analyze-pdf-lambda`

**Purpose:**
- Analyze PDF structure on-demand
- Count pages and estimate elements
- Calculate complexity and cost

**Inputs:**
- `job_id` from API request body

**Process:**
1. Get job record from DynamoDB
2. Update status to `ANALYZING`
3. Download PDF from S3
4. Use pdf-lib or similar to:
   - Count pages
   - Estimate elements (e.g., 30 elements per page average)
   - Calculate transactions (elements / 10)
   - Determine complexity based on size
5. Write results to DynamoDB
6. Update status to `ANALYSIS_COMPLETE`

**Environment Variables:**
- `JOBS_TABLE_NAME`
- `PDF_BUCKET_NAME`

**IAM Permissions:**
- DynamoDB: GetItem, UpdateItem
- S3: GetObject

### 3. Lambda Function: Start Processing
**Trigger:** API Gateway (manual)

**Function:** `start-processing-lambda`

**Purpose:**
- Initiate PDF remediation workflow
- Track processing status

**Inputs:**
- `job_id` from API request body

**Process:**
1. Get job record from DynamoDB
2. Update status to `PROCESSING`
3. Trigger existing remediation process (Step Functions, SQS, etc.)
4. Return success response

**Environment Variables:**
- `JOBS_TABLE_NAME`
- `PROCESSING_QUEUE_URL` or `STEP_FUNCTION_ARN`

**IAM Permissions:**
- DynamoDB: GetItem, UpdateItem
- SQS: SendMessage or Step Functions: StartExecution

### 4. Lambda Function: Process Completion Handler
**Trigger:** EventBridge or Step Function callback

**Function:** `processing-complete-lambda`

**Purpose:**
- Update job status when processing completes

**Process:**
1. Receive completion event with `job_id` and result
2. Update DynamoDB:
   - `status = "COMPLETED"` or `"FAILED"`
   - Store `processed_s3_key`, `processing_time_seconds`
   - Set `processing_completed_at`

### 5. API Gateway Endpoints

**Base Path:** `/api/jobs`

**Endpoints:**

#### `POST /api/jobs/analyze`
- **Auth:** Cognito JWT
- **Body:** `{ "job_id": "..." }`
- **Response:** `{ "message": "Analysis started" }`
- **Lambda:** `analyze-pdf-lambda`

#### `POST /api/jobs/start-processing`
- **Auth:** Cognito JWT
- **Body:** `{ "job_id": "..." }`
- **Response:** `{ "message": "Processing started" }`
- **Lambda:** `start-processing-lambda`

#### `GET /api/jobs/my-jobs`
- **Auth:** Cognito JWT
- **Query Params:** `user_sub={sub}` (extracted from JWT)
- **Response:**
  ```json
  {
    "jobs": [
      {
        "job_id": "...",
        "status": "UPLOADED",
        "file_name": "...",
        "created_at": "..."
      }
    ]
  }
  ```
- **Lambda:** `get-user-jobs-lambda`

#### `GET /api/jobs/{job_id}`
- **Auth:** Cognito JWT
- **Path Param:** `job_id`
- **Response:** Complete job record
- **Lambda:** `get-job-lambda`

**CDK Implementation:**
```typescript
const jobsApi = new apigateway.RestApi(this, 'JobsApi', {
  restApiName: 'PDF Jobs API',
});

const jobsResource = jobsApi.root.addResource('jobs');

jobsResource.addResource('analyze').addMethod('POST',
  new apigateway.LambdaIntegration(analyzeLambda), {
    authorizer: cognitoAuthorizer,
  }
);

jobsResource.addResource('start-processing').addMethod('POST',
  new apigateway.LambdaIntegration(startProcessingLambda), {
    authorizer: cognitoAuthorizer,
  }
);

jobsResource.addResource('my-jobs').addMethod('GET',
  new apigateway.LambdaIntegration(getUserJobsLambda), {
    authorizer: cognitoAuthorizer,
  }
);
```

**CDK Outputs:**
```typescript
new cdk.CfnOutput(this, 'AnalyzeJobEndpoint', {
  value: `${jobsApi.url}jobs/analyze`,
});

new cdk.CfnOutput(this, 'StartProcessingEndpoint', {
  value: `${jobsApi.url}jobs/start-processing`,
});

new cdk.CfnOutput(this, 'GetUserJobsEndpoint', {
  value: `${jobsApi.url}jobs/my-jobs`,
});
```

---

## Frontend Components to Modify

### 1. Create New Component: `FileActionsSection.jsx`
**Purpose:** Display uploaded file info and action buttons

**Props:**
- `jobData` - Job object from DynamoDB
- `onCheckFile` - Handler for "Check File" button
- `onStartProcessing` - Handler for "Start Processing" button
- `enableAnalysis` - Feature flag from env var

**Display:**
```
┌─────────────────────────────────────────┐
│  📄 uploaded_file.pdf                    │
│  Size: 15.2 MB                           │
│                                          │
│  ⚠ Large file detected (15.2 MB).       │
│     Processing may take longer and       │
│     consume more quota.                  │
│                                          │
│  [Check File]  [Start Processing]       │
└─────────────────────────────────────────┘
```

**Logic:**
- If `enableAnalysis === false`: Hide "Check File" button
- If `file_size_mb > 10`: Show red warning
- Button clicks trigger parent handlers

### 2. Modify: `MainApp.js`
**Add State:**
```javascript
const [currentJob, setCurrentJob] = useState(null);
const [jobStatus, setJobStatus] = useState(null);
const [enableAnalysis, setEnableAnalysis] = useState(
  process.env.REACT_APP_ENABLE_PRE_ANALYSIS === 'true'
);
```

**Add Session Recovery:**
```javascript
useEffect(() => {
  if (auth.isAuthenticated && awsCredentials) {
    recoverSession();
  }
}, [auth.isAuthenticated, awsCredentials]);

const recoverSession = async () => {
  try {
    const response = await fetch(GetUserJobsEndpoint, {
      headers: {
        Authorization: `Bearer ${auth.user.id_token}`
      }
    });
    const data = await response.json();

    if (data.jobs && data.jobs.length > 0) {
      // Get most recent active job
      const activeJob = data.jobs[0];
      setCurrentJob(activeJob);
      setJobStatus(activeJob.status);

      // Set UI page based on status
      switch (activeJob.status) {
        case 'UPLOADED':
          setCurrentPage('file-actions');
          break;
        case 'ANALYZING':
          setCurrentPage('analyzing');
          startPolling(activeJob.job_id);
          break;
        case 'ANALYSIS_COMPLETE':
          setCurrentPage('analysis-results');
          break;
        case 'PROCESSING':
          setCurrentPage('processing');
          startPolling(activeJob.job_id);
          break;
        case 'COMPLETED':
          setCurrentPage('results');
          break;
      }
    }
  } catch (error) {
    console.error('Session recovery failed:', error);
  }
};
```

**Update Upload Handler:**
```javascript
const handleUploadComplete = async (updated_filename, original_fileName, format, jobId) => {
  // Create DynamoDB record with status = "UPLOADED"
  const jobData = {
    job_id: jobId,
    user_sub: auth.user.profile.sub,
    user_email: auth.user.profile.email,
    status: 'UPLOADED',
    file_name: original_fileName,
    file_size_mb: fileSizeMB,
    s3_key: `uploads/${auth.user.profile.sub}/${jobId}.pdf`,
    created_at: new Date().toISOString(),
  };

  setCurrentJob(jobData);
  setJobStatus('UPLOADED');
  setCurrentPage('file-actions');

  // Optionally: Call backend API to create record
  // Or: Record is created during S3 upload via Lambda trigger
};
```

**Add Analysis Handler:**
```javascript
const handleCheckFile = async () => {
  try {
    setCurrentPage('analyzing');

    const response = await fetch(AnalyzeJobEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.user.id_token}`
      },
      body: JSON.stringify({ job_id: currentJob.job_id })
    });

    if (!response.ok) throw new Error('Analysis request failed');

    // Start polling for results
    startPolling(currentJob.job_id);
  } catch (error) {
    console.error('Failed to start analysis:', error);
    setAnalysisError(error.message);
    setCurrentPage('file-actions');
  }
};
```

**Add Polling Function:**
```javascript
const startPolling = (jobId) => {
  const pollInterval = setInterval(async () => {
    try {
      const response = await fetch(`${GetJobEndpoint}/${jobId}`, {
        headers: {
          Authorization: `Bearer ${auth.user.id_token}`
        }
      });

      const job = await response.json();
      setCurrentJob(job);
      setJobStatus(job.status);

      // Stop polling when state changes
      if (job.status === 'ANALYSIS_COMPLETE' ||
          job.status === 'COMPLETED' ||
          job.status === 'FAILED') {
        clearInterval(pollInterval);

        // Update UI page
        if (job.status === 'ANALYSIS_COMPLETE') {
          setCurrentPage('analysis-results');
        } else if (job.status === 'COMPLETED') {
          setCurrentPage('results');
        } else if (job.status === 'FAILED') {
          setCurrentPage('error');
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, 2000); // Poll every 2 seconds
};
```

### 3. Modify: `UploadSection.jsx`
**Change Upload Target:**
- Upload files to: `uploads/{user_sub}/{job_id}.pdf`
- No longer use `pdf-upload/` prefix

**Remove Automatic Analysis:**
- Remove the analysis polling code from upload handler
- Just upload and return to parent with job info

### 4. Modify: `AnalysisResultsSection.jsx`
**Update to use job data:**
```javascript
function AnalysisResultsSection({ jobData, onStartProcessing, onCancel }) {
  // Display jobData.num_pages, jobData.estimated_elements, etc.
}
```

### 5. Update: `constants.jsx`
**Add new endpoints:**
```javascript
export const AnalyzeJobEndpoint = process.env.REACT_APP_ANALYZE_JOB_API;
export const StartProcessingEndpoint = process.env.REACT_APP_START_PROCESSING_API;
export const GetUserJobsEndpoint = process.env.REACT_APP_GET_USER_JOBS_API;
export const GetJobEndpoint = process.env.REACT_APP_GET_JOB_API;
export const EnablePreAnalysis = process.env.REACT_APP_ENABLE_PRE_ANALYSIS === 'true';
```

### 6. Update: `buildspec-frontend.yml`
**Add environment variables:**
```yaml
REACT_APP_ANALYZE_JOB_API=$REACT_APP_ANALYZE_JOB_ENDPOINT
REACT_APP_START_PROCESSING_API=$REACT_APP_START_PROCESSING_ENDPOINT
REACT_APP_GET_USER_JOBS_API=$REACT_APP_GET_USER_JOBS_ENDPOINT
REACT_APP_GET_JOB_API=$REACT_APP_GET_JOB_ENDPOINT
REACT_APP_JOBS_TABLE_NAME=$JOBS_TABLE_NAME
REACT_APP_ENABLE_PRE_ANALYSIS=$ENABLE_PRE_ANALYSIS
```

### 7. Update: `deploy-frontend.sh`
**Extract new CDK outputs:**
```bash
REACT_APP_ANALYZE_JOB_ENDPOINT=$(echo "$CDK_OUTPUTS" | jq -r '.[] | select(.OutputKey == "AnalyzeJobEndpoint") | .OutputValue')
REACT_APP_START_PROCESSING_ENDPOINT=$(echo "$CDK_OUTPUTS" | jq -r '.[] | select(.OutputKey == "StartProcessingEndpoint") | .OutputValue')
REACT_APP_GET_USER_JOBS_ENDPOINT=$(echo "$CDK_OUTPUTS" | jq -r '.[] | select(.OutputKey == "GetUserJobsEndpoint") | .OutputValue')
REACT_APP_GET_JOB_ENDPOINT=$(echo "$CDK_OUTPUTS" | jq -r '.[] | select(.OutputKey == "GetJobEndpoint") | .OutputValue')
JOBS_TABLE_NAME=$(echo "$CDK_OUTPUTS" | jq -r '.[] | select(.OutputKey == "JobsTableName") | .OutputValue')

# Add to environment variables
add_frontend_env_var "REACT_APP_ANALYZE_JOB_ENDPOINT" "$REACT_APP_ANALYZE_JOB_ENDPOINT"
add_frontend_env_var "REACT_APP_START_PROCESSING_ENDPOINT" "$REACT_APP_START_PROCESSING_ENDPOINT"
add_frontend_env_var "REACT_APP_GET_USER_JOBS_ENDPOINT" "$REACT_APP_GET_USER_JOBS_ENDPOINT"
add_frontend_env_var "REACT_APP_GET_JOB_ENDPOINT" "$REACT_APP_GET_JOB_ENDPOINT"
add_frontend_env_var "JOBS_TABLE_NAME" "$JOBS_TABLE_NAME"
add_frontend_env_var "ENABLE_PRE_ANALYSIS" "true"
```

---

## Configuration

### Environment Variable: `ENABLE_PRE_ANALYSIS`

**Purpose:** Toggle the pre-analysis feature on/off

**Values:**
- `true` - Show "Check File" button, enable analysis workflow
- `false` - Hide "Check File" button, only allow direct processing

**Where to Set:**
1. CDK Backend (default):
   ```typescript
   const enablePreAnalysis = process.env.ENABLE_PRE_ANALYSIS || 'true';
   ```

2. Frontend build (buildspec):
   ```bash
   REACT_APP_ENABLE_PRE_ANALYSIS=${ENABLE_PRE_ANALYSIS:-true}
   ```

3. CodeBuild project:
   - Add environment variable `ENABLE_PRE_ANALYSIS=true` to project

---

## Implementation Steps

### Phase 1: Backend Infrastructure
1. ✅ Create DynamoDB table with GSI
2. ✅ Create Lambda: Analyze PDF
3. ✅ Create Lambda: Start Processing
4. ✅ Create Lambda: Get User Jobs
5. ✅ Create Lambda: Get Job by ID
6. ✅ Create API Gateway with endpoints
7. ✅ Add CDK outputs for all endpoints
8. ✅ Update IAM roles and permissions
9. ✅ Deploy CDK stack

### Phase 2: Frontend Updates
1. ✅ Add new constants for endpoints
2. ✅ Create `FileActionsSection.jsx` component
3. ✅ Update `MainApp.js` with session recovery
4. ✅ Update `MainApp.js` with polling logic
5. ✅ Update `MainApp.js` with analysis handlers
6. ✅ Modify `UploadSection.jsx` upload path
7. ✅ Update `AnalysisResultsSection.jsx` to use job data
8. ✅ Update `buildspec-frontend.yml` with new env vars
9. ✅ Update `deploy-frontend.sh` to extract new outputs
10. ✅ Test and deploy frontend

### Phase 3: Integration & Testing
1. ✅ Test upload → file actions display
2. ✅ Test "Check File" → analysis flow
3. ✅ Test "Start Processing" (with analysis)
4. ✅ Test "Start Processing" (without analysis)
5. ✅ Test page reload recovery for all states
6. ✅ Test large file warning (> 10MB)
7. ✅ Test feature flag (ENABLE_PRE_ANALYSIS)
8. ✅ Test error scenarios and FAILED state
9. ✅ Verify TTL cleanup after 7 days

---

## Success Criteria

### Must Have:
- ✅ User can upload file and see file info with 2 action buttons
- ✅ User can manually trigger analysis by clicking "Check File"
- ✅ User can skip analysis and click "Start Processing" directly
- ✅ Page reload preserves session and shows current job state
- ✅ DynamoDB stores all job states
- ✅ Analysis and processing are triggered by API calls, not S3 events
- ✅ Large file warning displays for files > 10MB
- ✅ Feature flag allows disabling analysis feature

### Nice to Have:
- ✅ TTL auto-cleanup of old jobs (7 days)
- ✅ Error retry mechanism
- ✅ Job history view (last N jobs)
- ⬜ Email notifications on completion
- ⬜ Webhook callbacks for job status changes

---

## Open Questions (To Be Decided)

### 1. File Organization
**Decision: Option A - Single location**
- All files in `uploads/{user_sub}/{job_id}.pdf`
- Status tracked in DynamoDB, not by S3 prefix
- Simpler and cleaner

### 2. Job Listing on Reload
**Options:**
- **Option A:** Show only the most recent active job
- **Option B:** Show all active jobs (if multiple exist)
- **Option C:** Show last 5 jobs with statuses

**Recommendation:** Start with Option A, expand to Option C later

### 3. Job Cleanup Strategy
**Options:**
- **Option A:** DynamoDB TTL only (7 days)
- **Option B:** TTL + S3 lifecycle rules (delete files after 7 days)
- **Option C:** Manual cleanup Lambda (weekly)

**Recommendation:** Option B (TTL + S3 lifecycle)

---

## Migration Notes

### Backward Compatibility
**Current System:**
- Files uploaded to `pdf-upload/` prefix
- S3 event triggers processing automatically
- No DynamoDB tracking

**New System:**
- Files uploaded to `uploads/` prefix
- API triggers processing manually
- DynamoDB tracks all states

**Migration Strategy:**
- Keep old `pdf-upload/` trigger active during transition
- Add new system in parallel
- Frontend uses feature flag to switch
- Eventually deprecate old system

### Rollback Plan
If new system fails:
1. Set `ENABLE_PRE_ANALYSIS=false`
2. Frontend falls back to direct processing
3. Old S3 trigger still works
4. No data loss - DynamoDB records are informational

---

## File Size Warning Specification

### Trigger: File size > 10MB

### Warning Message:
```
⚠ Large file detected (15.2 MB). Processing may take longer and consume more quota.
```

### Style:
- **Color:** Red (#dc3545)
- **Icon:** Warning triangle (⚠)
- **Tone:** Informative, not panic-inducing
- **Placement:** Between file info and action buttons

### Implementation:
```jsx
{fileSizeMB > 10 && (
  <Box sx={{
    color: '#dc3545',
    backgroundColor: '#fff3cd',
    padding: 2,
    borderRadius: 1,
    marginY: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 1
  }}>
    <WarningIcon />
    <Typography variant="body2">
      Large file detected ({fileSizeMB} MB). Processing may take longer and consume more quota.
    </Typography>
  </Box>
)}
```

---

## Testing Checklist

### Functional Tests
- [ ] Upload file → See file info and 2 buttons
- [ ] Click "Check File" → Analysis starts, spinner shows
- [ ] Analysis completes → Results display correctly
- [ ] Click "Start Processing" after analysis → Processing starts
- [ ] Click "Start Processing" without analysis → Processing starts
- [ ] Page reload during UPLOADED → Returns to file actions
- [ ] Page reload during ANALYZING → Resumes polling, shows spinner
- [ ] Page reload during ANALYSIS_COMPLETE → Shows results
- [ ] Page reload during PROCESSING → Resumes polling, shows spinner
- [ ] Page reload when COMPLETED → Shows download section
- [ ] Large file (>10MB) → Warning displays
- [ ] Feature flag OFF → "Check File" button hidden
- [ ] Feature flag ON → Both buttons visible

### Error Scenarios
- [ ] Analysis fails → FAILED state, error message shown
- [ ] Processing fails → FAILED state, error message shown
- [ ] Invalid job_id → Appropriate error handling
- [ ] Network error during polling → Retry logic works
- [ ] DynamoDB throttling → Backoff and retry

### Performance Tests
- [ ] Polling doesn't cause memory leaks
- [ ] Multiple reloads don't create duplicate polling
- [ ] DynamoDB queries are efficient (using GSI)
- [ ] S3 file access is secure (signed URLs)

---

## Security Considerations

### Authentication
- All API endpoints require Cognito JWT
- User can only access their own jobs (user_sub validation)

### Authorization
- Lambda validates user_sub from JWT matches job owner
- S3 file access uses temporary credentials
- No direct S3 URLs exposed to frontend

### Data Privacy
- Job records include user_email for auditing
- TTL ensures automatic data deletion
- No sensitive data stored in DynamoDB

---

## Monitoring & Observability

### CloudWatch Metrics
- Track job state transitions
- Monitor Lambda execution times
- Alert on high failure rates

### Logs
- Lambda logs include job_id for tracing
- API Gateway logs include user_sub
- DynamoDB streams for audit trail

### Dashboards
- Active jobs by status
- Average processing time
- Error rates by status transition

---

## Cost Implications

### DynamoDB
- Pay-per-request pricing
- Estimated cost: $0.25 per 1M requests
- TTL is free

### Lambda
- Analysis: ~5 seconds per file
- API handlers: <1 second each
- Estimated cost: $0.20 per 1,000 executions

### API Gateway
- $3.50 per million API calls
- WebSocket if needed: $1.00 per million messages

### Total Estimated Cost
- For 10,000 jobs/month: ~$5-10/month additional

---

## Future Enhancements

### Phase 2 Features
1. **Job History View**
   - Show last 10 jobs with statuses
   - Allow re-download of completed files

2. **Email Notifications**
   - Send email when job completes
   - Optional: Send when analysis completes

3. **Batch Processing**
   - Upload multiple files at once
   - Track as separate jobs

4. **Admin Dashboard**
   - View all user jobs
   - Monitor system health
   - Manage quotas

5. **Webhooks**
   - Allow users to register webhook URLs
   - Send POST request on job completion

---

## References

### AWS Documentation
- DynamoDB TTL: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html
- API Gateway Cognito Auth: https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html
- Lambda Best Practices: https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html

### Related Files
- `/home/andreyf/projects/PDF_accessability_UI/pdf_ui/src/MainApp.js`
- `/home/andreyf/projects/PDF_accessability_UI/pdf_ui/src/components/UploadSection.jsx`
- `/home/andreyf/projects/PDF_accessability_UI/pdf_ui/src/utilities/constants.jsx`
- `/home/andreyf/projects/PDF_accessability_UI/cdk_backend/lib/cdk_backend-stack.ts`
- `/home/andreyf/projects/PDF_accessability_UI/buildspec-frontend.yml`
- `/home/andreyf/projects/PDF_accessability_UI/deploy-frontend.sh`

---

## Document Version
- **Version:** 1.0
- **Created:** 2025-01-10
- **Author:** Claude Code Assistant
- **Status:** Ready for Implementation
