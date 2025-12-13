# Implementation Plan: Job History Table & Management

## Overview
Enhance the UI to show a job history table under the Upload widget, allowing users to view, resume, and delete past jobs. Prevent automatic session recovery and block uploads during active processing.

---

## Phase 1: Backend - Delete Job API

### 1.1 Create `deleteJob` Lambda Function

**Location**: `/cdk_backend/lambda/deleteJob/index.py`

**Functionality**:
- Accept `job_id` from authenticated user
- Verify job belongs to requesting user (security check)
- Hard delete from DynamoDB
- Optionally delete associated S3 files (uploaded PDF, processed results, analysis reports)
- Return success/failure response

**Input**:
```json
{
  "job_id": "uuid-string",
  "cleanup_s3": true  // Optional: default true
}
```

**Output**:
```json
{
  "success": true,
  "message": "Job deleted successfully",
  "deleted_files": ["pdf/file.pdf", "result/file.pdf", "temp/analysis.json"]
}
```

**S3 Cleanup Logic**:
```python
# Delete these S3 keys if they exist:
# 1. Original upload: pdf/{job_id}.pdf or pdf/{sanitized_filename}
# 2. Processed result: result/COMPLIANT_{filename}
# 3. Analysis report: temp/{job_id}_accessibility_report.json
# 4. Chunked files: pdf/{job_id}_chunk_*.pdf (if processing was interrupted)
```

**Error Handling**:
- 403: Job doesn't belong to user
- 404: Job not found
- 500: DynamoDB or S3 errors

### 1.2 Update CDK Stack

**File**: `/cdk_backend/lib/cdk_backend-stack.ts`

**Changes**:
1. Create new Lambda function for deleteJob
2. Add API Gateway route: `DELETE /jobs/{job_id}`
3. Grant DynamoDB delete permissions
4. Grant S3 delete permissions for PDF_TO_PDF_BUCKET
5. Add Cognito authorizer to route

**API Gateway Route**:
```typescript
const deleteJobLambda = new lambda.Function(this, 'DeleteJobFunction', {
  runtime: lambda.Runtime.PYTHON_3_9,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/deleteJob'),
  environment: {
    JOBS_TABLE_NAME: jobsTable.tableName,
    PDF_BUCKET: pdfBucket
  }
});

// Grant permissions
jobsTable.grantReadWriteData(deleteJobLambda);
// Grant S3 delete permissions for cleanup

// API route: DELETE /jobs/{job_id}
```

---

## Phase 2: Frontend - Job History Table Component

### 2.1 Create `JobHistoryTable.jsx`

**Location**: `/pdf_ui/src/components/JobHistoryTable.jsx`

**Component Structure**:
```jsx
const JobHistoryTable = ({
  jobs,              // Array of job objects
  onSelectJob,       // (job) => void - Resume/view a job
  onDeleteJob,       // (jobId) => Promise<void> - Delete a job
  onLoadMore,        // () => void - Load more jobs
  hasMore,           // boolean - More jobs available
  loading,           // boolean - Loading state
  idToken            // string - Auth token for API calls
})
```

**Initial Display**: Show 5 most recent jobs
**Expand**: "Show More" button loads additional 10 jobs (5 → 15 → 25, etc.)

**Table Columns**:
| Column | Content | Width |
|--------|---------|-------|
| **Filename** | Original filename + job icon | 30% |
| **Status** | Color-coded badge | 15% |
| **Info** | Size, pages (if available) | 20% |
| **Created** | Relative time (e.g., "2 hours ago") | 15% |
| **Actions** | Context buttons | 20% |

**Status Badge Colors**:
```javascript
const statusColors = {
  UPLOADED: '#2196F3',      // Blue
  ANALYZING: '#FF9800',     // Orange
  ANALYSIS_COMPLETE: '#9C27B0', // Purple
  PROCESSING: '#FF9800',    // Orange
  COMPLETED: '#4CAF50',     // Green
  FAILED: '#F44336',        // Red
  CANCELLED: '#757575'      // Gray
};
```

**Action Buttons by Status**:
```javascript
const getActions = (status) => {
  switch(status) {
    case 'UPLOADED':
      return [
        { label: 'Resume', icon: PlayIcon, action: 'resume' },
        { label: 'Delete', icon: DeleteIcon, action: 'delete' }
      ];
    case 'ANALYZING':
      return [
        { label: 'View', icon: VisibilityIcon, action: 'view', disabled: true },
        { label: 'Cancel', icon: CancelIcon, action: 'cancel' }
      ];
    case 'ANALYSIS_COMPLETE':
      return [
        { label: 'View Analysis', icon: AssessmentIcon, action: 'view-analysis' },
        { label: 'Process', icon: PlayIcon, action: 'start-processing' },
        { label: 'Delete', icon: DeleteIcon, action: 'delete' }
      ];
    case 'PROCESSING':
      return [
        { label: 'View', icon: VisibilityIcon, action: 'view', disabled: true },
        { label: 'Cancel', icon: CancelIcon, action: 'cancel' }
      ];
    case 'COMPLETED':
      return [
        { label: 'View Result', icon: CheckCircleIcon, action: 'view-result' },
        { label: 'Download', icon: DownloadIcon, action: 'download' },
        { label: 'Delete', icon: DeleteIcon, action: 'delete' }
      ];
    case 'FAILED':
    case 'CANCELLED':
      return [
        { label: 'Delete', icon: DeleteIcon, action: 'delete' }
      ];
  }
};
```

**Delete Confirmation Dialog**:
```jsx
<Dialog open={deleteDialogOpen}>
  <DialogTitle>Delete Job?</DialogTitle>
  <DialogContent>
    <Typography>
      Are you sure you want to delete "{jobToDelete.file_name}"?
      This will remove the job record and all associated files from storage.
    </Typography>
    <Typography variant="caption" color="error">
      This action cannot be undone.
    </Typography>
  </DialogContent>
  <DialogActions>
    <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
    <Button onClick={handleConfirmDelete} color="error" variant="contained">
      Delete
    </Button>
  </DialogActions>
</Dialog>
```

**Responsive Design**:
- Desktop: Full table with all columns
- Tablet: Collapse "Info" into filename row
- Mobile: Card-based layout (stack vertically)

### 2.2 Update `MainApp.js`

**New State Variables**:
```javascript
const [allJobs, setAllJobs] = useState([]);        // All user jobs
const [displayedJobs, setDisplayedJobs] = useState([]); // Currently displayed jobs
const [jobsToShow, setJobsToShow] = useState(5);   // Number of jobs to display
const [hasActiveJob, setHasActiveJob] = useState(false); // Block uploads if true
```

**Modify Session Recovery** (`recoverSession` function):
```javascript
// BEFORE (Line 498-530):
if (data.jobs && data.jobs.length > 0) {
  const activeJob = data.jobs.find(job =>
    ['UPLOADED', 'ANALYZING', 'ANALYSIS_COMPLETE', 'PROCESSING'].includes(job.status)
  );
  if (activeJob) {
    // Auto-navigate to job page
  }
}

// AFTER:
if (data.jobs && data.jobs.length > 0) {
  setAllJobs(data.jobs);
  setDisplayedJobs(data.jobs.slice(0, 5)); // Show first 5

  // Check if there's an active job (ANALYZING or PROCESSING only)
  const activeJob = data.jobs.find(job =>
    ['ANALYZING', 'PROCESSING'].includes(job.status)
  );

  if (activeJob) {
    setHasActiveJob(true);
    // Show warning banner: "You have a job in progress"
  }

  // Always stay on upload page - no auto-navigation
  setCurrentPage('upload');
}
```

**New Handler Functions**:
```javascript
// Handle "Show More" button
const handleLoadMoreJobs = () => {
  const newCount = jobsToShow + 10;
  setJobsToShow(newCount);
  setDisplayedJobs(allJobs.slice(0, newCount));
};

// Handle job selection from table
const handleSelectJob = (job, action) => {
  setCurrentJob(job);
  setJobStatus(job.status);

  switch(action) {
    case 'resume':
      // UPLOADED job - go to file-actions
      setUploadedFile({
        name: job.file_name,
        updatedName: job.s3_key,
        format: 'pdf',
        jobId: job.job_id,
        size: job.file_size_mb
      });
      setCurrentPage('file-actions');
      break;

    case 'view-analysis':
      // ANALYSIS_COMPLETE - go to analysis results
      setAnalysisData(job);
      setCurrentPage('analysis-results');
      break;

    case 'start-processing':
      // Start processing from ANALYSIS_COMPLETE
      handleStartProcessingFromFileActions();
      break;

    case 'view-result':
      // COMPLETED - go to results page
      setUploadedFile({
        name: job.file_name,
        updatedName: job.s3_key,
        format: 'pdf',
        jobId: job.job_id
      });
      setProcessedResult({ url: job.processed_s3_key });
      setCurrentPage('results');
      break;

    case 'download':
      // COMPLETED - trigger download directly
      handleDownloadFromTable(job);
      break;

    case 'cancel':
      // Cancel ANALYZING or PROCESSING job
      handleCancelJob(job.job_id);
      break;

    case 'delete':
      // Show delete confirmation
      handleDeleteJob(job.job_id);
      break;
  }
};

// Handle job deletion
const handleDeleteJob = async (jobId) => {
  // Show confirmation dialog first
  setJobToDelete(jobId);
  setShowDeleteDialog(true);
};

const handleConfirmDelete = async () => {
  try {
    const response = await fetch(`${DeleteJobEndpoint}/${jobToDelete}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.user.id_token}`
      },
      body: JSON.stringify({ cleanup_s3: true })
    });

    if (!response.ok) {
      throw new Error('Failed to delete job');
    }

    // Remove from local state
    setAllJobs(prev => prev.filter(j => j.job_id !== jobToDelete));
    setDisplayedJobs(prev => prev.filter(j => j.job_id !== jobToDelete));

    // Update active job status
    checkForActiveJobs();

    console.log('Job deleted successfully');
  } catch (error) {
    console.error('Error deleting job:', error);
    // Show error toast
  } finally {
    setShowDeleteDialog(false);
    setJobToDelete(null);
  }
};

// Check if user has active jobs
const checkForActiveJobs = useCallback(() => {
  const active = allJobs.some(job =>
    ['ANALYZING', 'PROCESSING'].includes(job.status)
  );
  setHasActiveJob(active);
}, [allJobs]);
```

### 2.3 Update `UploadSection.jsx`

**Add Active Job Warning**:
```jsx
{hasActiveJob && (
  <Alert severity="warning" sx={{ mb: 2 }}>
    You have a job currently processing. Please wait for it to complete before uploading a new file.
  </Alert>
)}

<Button
  variant="contained"
  disabled={hasActiveJob || uploading}
  onClick={handleUpload}
>
  {hasActiveJob ? 'Processing Job Active' : 'Upload PDF'}
</Button>
```

**Props Update**:
```javascript
<UploadSection
  // ... existing props
  hasActiveJob={hasActiveJob}  // NEW
  onUploadBlocked={() => {
    // Show toast: "Please wait for current job to complete"
  }}
/>
```

### 2.4 Update `constants.js`

**Add Delete Endpoint**:
```javascript
export const DeleteJobEndpoint = process.env.REACT_APP_DELETE_JOB_ENDPOINT;
```

---

## Phase 3: Integration & Testing

### 3.1 Update Environment Variables

**Amplify Environment Variables** (buildspec-frontend.yml):
```yaml
- echo "REACT_APP_DELETE_JOB_ENDPOINT=$DELETE_JOB_ENDPOINT" >> .env
```

**CDK Stack Output**:
```typescript
new cdk.CfnOutput(this, 'DeleteJobEndpointUrl', {
  value: api.url + 'jobs/{job_id}',
  description: 'DELETE endpoint for jobs'
});
```

### 3.2 State Management Flow

```
User Logs In
    ↓
recoverSession() fetches all jobs
    ↓
Store in allJobs state
    ↓
Display first 5 in JobHistoryTable
    ↓
Check for ANALYZING/PROCESSING jobs → setHasActiveJob(true)
    ↓
If hasActiveJob: Block upload, show warning
    ↓
User clicks "Show More" → Display next 10 jobs
    ↓
User selects job → Navigate to appropriate page based on status
    ↓
User deletes job → Confirm → API call → Remove from state → Re-check active jobs
```

### 3.3 Upload Blocking Logic

```javascript
// In UploadSection.jsx
const handleUploadClick = () => {
  if (hasActiveJob) {
    showToast('error', 'Please wait for your current job to complete before uploading a new file');
    return;
  }

  // Proceed with upload
  triggerFileInput();
};

// Also disable drag-and-drop
const handleDrop = (e) => {
  e.preventDefault();

  if (hasActiveJob) {
    showToast('error', 'Upload blocked - active job in progress');
    return;
  }

  // Handle file drop
};
```

---

## Phase 4: UI/UX Enhancements

### 4.1 Job Status Indicators

**Add visual indicators for active jobs**:
```jsx
// In JobHistoryTable row
{job.status === 'ANALYZING' && (
  <Box sx={{ display: 'flex', alignItems: 'center' }}>
    <CircularProgress size={16} sx={{ mr: 1 }} />
    <Typography variant="caption">Analyzing...</Typography>
  </Box>
)}

{job.status === 'PROCESSING' && (
  <Box sx={{ display: 'flex', alignItems: 'center' }}>
    <CircularProgress size={16} sx={{ mr: 1 }} />
    <Typography variant="caption">Processing...</Typography>
  </Box>
)}
```

### 4.2 Empty State

**When no jobs exist**:
```jsx
{displayedJobs.length === 0 && (
  <Box sx={{ textAlign: 'center', py: 4 }}>
    <UploadFileIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
    <Typography variant="h6" color="text.secondary">
      No jobs yet
    </Typography>
    <Typography variant="body2" color="text.secondary">
      Upload your first PDF to get started
    </Typography>
  </Box>
)}
```

### 4.3 Loading State

**While fetching jobs**:
```jsx
{loadingJobs && (
  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
    <CircularProgress />
  </Box>
)}
```

### 4.4 Error Handling

**Delete errors**:
```jsx
const [deleteError, setDeleteError] = useState(null);

{deleteError && (
  <Alert severity="error" onClose={() => setDeleteError(null)}>
    Failed to delete job: {deleteError}
  </Alert>
)}
```

---

## Implementation Checklist

### Backend Tasks
- [ ] Create `/cdk_backend/lambda/deleteJob/index.py`
  - [ ] Implement job deletion logic
  - [ ] Add user verification
  - [ ] Add S3 cleanup (pdf/, result/, temp/ directories)
  - [ ] Handle errors (403, 404, 500)
- [ ] Update `/cdk_backend/lib/cdk_backend-stack.ts`
  - [ ] Add deleteJob Lambda function
  - [ ] Create API Gateway route: `DELETE /jobs/{job_id}`
  - [ ] Grant DynamoDB delete permissions
  - [ ] Grant S3 delete permissions
  - [ ] Add Cognito authorizer
- [ ] Deploy CDK stack
- [ ] Test delete endpoint with Postman/curl
- [ ] Update Amplify environment variables

### Frontend Tasks
- [ ] Create `/pdf_ui/src/components/JobHistoryTable.jsx`
  - [ ] Implement table layout with columns
  - [ ] Add status badges with colors
  - [ ] Implement action buttons per status
  - [ ] Add delete confirmation dialog
  - [ ] Add "Show More" functionality
  - [ ] Add responsive design (mobile/tablet/desktop)
  - [ ] Add empty state
  - [ ] Add loading state
- [ ] Update `/pdf_ui/src/MainApp.js`
  - [ ] Add new state variables (allJobs, displayedJobs, hasActiveJob)
  - [ ] Modify `recoverSession` to NOT auto-navigate
  - [ ] Add `handleSelectJob` function
  - [ ] Add `handleDeleteJob` function
  - [ ] Add `checkForActiveJobs` function
  - [ ] Add `handleLoadMoreJobs` function
  - [ ] Pass props to JobHistoryTable
- [ ] Update `/pdf_ui/src/components/UploadSection.jsx`
  - [ ] Add `hasActiveJob` prop
  - [ ] Show warning alert when job is active
  - [ ] Disable upload button when active
  - [ ] Disable drag-and-drop when active
  - [ ] Show toast on upload attempt when blocked
- [ ] Update `/pdf_ui/src/utilities/constants.js`
  - [ ] Add `DeleteJobEndpoint` constant
- [ ] Update `/pdf_ui/buildspec-frontend.yml`
  - [ ] Add DELETE_JOB_ENDPOINT environment variable

### Testing Tasks
- [ ] Test delete job (with S3 cleanup)
- [ ] Test delete job (without S3 cleanup)
- [ ] Test job selection for each status
- [ ] Test "Show More" functionality
- [ ] Test upload blocking when active job exists
- [ ] Test session recovery (no auto-navigation)
- [ ] Test delete confirmation dialog
- [ ] Test responsive design on mobile/tablet
- [ ] Test error handling (network errors, 403, 404)

### Edge Cases to Test
- [ ] Delete job while it's processing
- [ ] Delete job that has already been deleted
- [ ] Select job that was deleted by another session
- [ ] Multiple active jobs (should only check ANALYZING/PROCESSING)
- [ ] Job status changes while viewing table
- [ ] S3 files missing during deletion
- [ ] Network timeout during deletion

---

## Migration Notes

### Breaking Changes
- **Session recovery behavior changed**: Users will NO LONGER be automatically redirected to analysis results after login
- **Upload blocking**: Users with active jobs cannot upload new files (load reduction)

### Backward Compatibility
- Existing jobs in DynamoDB will work without migration
- No database schema changes required
- New DELETE endpoint is additive (doesn't break existing APIs)

---

## Rollback Plan

If issues arise:
1. **Remove DELETE route** from API Gateway (preserve Lambda for debugging)
2. **Revert session recovery logic** to previous auto-navigation behavior
3. **Hide JobHistoryTable** component (comment out in MainApp.js)
4. **Remove upload blocking** logic from UploadSection

---

## Future Enhancements (Post-MVP)

1. **Real-time updates**: Use WebSocket or polling to update job table when status changes
2. **Bulk actions**: Select multiple jobs and delete in batch
3. **Search/filter**: Filter jobs by status, date range, filename
4. **Sort options**: Sort by date, filename, status, size
5. **Job details modal**: Click filename to see full job details without navigating
6. **Export job history**: Download CSV of all jobs
7. **Notifications**: Email when job completes (if user navigated away)

---

## Estimated Timeline

- **Phase 1 (Backend)**: 2-3 hours
- **Phase 2 (Frontend)**: 4-5 hours
- **Phase 3 (Integration)**: 1-2 hours
- **Phase 4 (Testing)**: 2-3 hours

**Total**: ~10-13 hours of development time
