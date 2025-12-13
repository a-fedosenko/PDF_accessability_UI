# Lessons Learned - Bug Fixes Analysis

This document analyzes the 7 recent bug fixes to identify root causes and establish guidelines to prevent similar issues in the future.

---

## 1. S3 Event Format Mismatch (Commit 9ad0660)

### Problem
The `startProcessing` Lambda was sending a simple JSON payload to the `SplitPDF` Lambda, but `SplitPDF` expected a full S3 event format with a `Records` array. This caused `UnboundLocalError` failures.

### Root Cause
**Contract Mismatch**: The consumer Lambda (`SplitPDF`) was designed to handle S3 trigger events, but the producer Lambda sent a custom payload format without checking the expected interface.

### How to Avoid

1. **Document Lambda Input Contracts**
   - Create interface documentation for each Lambda function
   - Document expected input format (S3 event, API Gateway event, custom JSON)
   - Include example payloads in comments or documentation

2. **Shared Event Types**
   - Create shared type definitions or schemas for custom events
   - Use JSON Schema or TypeScript types for validation
   - Consider using AWS EventBridge Schema Registry

3. **Integration Testing**
   - Test Lambda invocations end-to-end
   - Mock Lambda invocations with realistic payloads
   - Validate error handling for malformed inputs

---

## 2. CDK Context Not Persisted (Commit 47f36c9)

### Problem
The CDK stack was deployed without the `PDF_TO_PDF_BUCKET` context value, resulting in IAM policies with "Null" bucket ARN that blocked all S3 uploads with `AccessDenied` errors.

### Root Cause
**Missing Configuration Management**: CDK context values were passed at runtime but not persisted in `cdk.context.json`, causing deployments to lose critical configuration.

### How to Avoid

1. **Persist Required Context**
   - Always commit `cdk.context.json` when it contains essential configuration
   - Document required context parameters in README
   - Use CDK's `--context` flag consistently across deployments

2. **Validate Infrastructure Outputs**
   - After deployment, verify IAM policies contain actual resource ARNs
   - Add post-deployment validation scripts
   - Check CloudFormation outputs for placeholder values

3. **Environment Configuration**
   - Use AWS Systems Manager Parameter Store or Secrets Manager for configuration
   - Implement configuration validation in CDK code
   - Fail fast if required configuration is missing

---

## 3. Path Mismatch Between Systems (Commit 1617eeb)

### Problem
Frontend uploaded files to `uploads/{user_sub}/` but the `PDFAccessibility` stack Lambdas expected files in the `pdf/` directory, causing Step Functions to fail.

### Root Cause
**Implicit Path Contracts**: Different parts of the system assumed different S3 path structures without explicit coordination or documentation.

### How to Avoid

1. **Centralize Path Configuration**
   - Create a shared constants file for S3 prefixes
   - Use environment variables for configurable paths
   - Document path conventions in architecture diagrams

2. **Path Convention Documentation**
   ```javascript
   // constants.js
   export const S3_PATHS = {
     UPLOAD: 'pdf/',           // Input files for processing
     RESULT: 'result/',        // Processed compliant files
     TEMP: 'temp/',           // Temporary processing files
     REPORTS: 'accessibility-reports/'
   };
   ```

3. **Cross-Stack Communication**
   - Export/import S3 path patterns between CDK stacks
   - Use CloudFormation exports for shared configuration
   - Document inter-stack dependencies

---

## 4. React useEffect Dependency Loops (Commit c6c0c07)

### Problem
Two critical React issues:
1. `pollingAttempts` in state caused infinite re-renders when included in useEffect dependencies
2. `recoverSession` ran multiple times due to missing guard flag

### Root Cause
**State Management Anti-patterns**:
- Using state for values that don't need to trigger re-renders
- Missing guard flags for one-time operations
- Incorrect useEffect dependency arrays

### How to Avoid

1. **Choose Correct State Type**
   ```javascript
   // ❌ BAD - causes re-renders and dependency issues
   const [counter, setCounter] = useState(0);

   // ✅ GOOD - local variable inside effect
   useEffect(() => {
     let counter = 0;
     const interval = setInterval(() => {
       counter++;
       // use counter
     }, 1000);
   }, []);

   // ✅ GOOD - useRef for mutable values
   const counterRef = useRef(0);
   ```

2. **Guard One-Time Operations**
   ```javascript
   const [hasInitialized, setHasInitialized] = useState(false);

   useEffect(() => {
     if (hasInitialized) return;

     // one-time initialization
     initializeApp();
     setHasInitialized(true);
   }, [hasInitialized]);
   ```

3. **Audit useEffect Dependencies**
   - Use ESLint's `react-hooks/exhaustive-deps` rule
   - Understand when to use `useCallback` and `useMemo`
   - Document intentional dependency omissions

---

## 5. Multiple Integration Issues (Commit c7d5180)

### Problem
Three separate issues:
1. Job lookup failed because job_id extraction didn't account for chunked filenames (_chunk_N suffix)
2. Accessibility report paths had duplicate `pdf/` prefix
3. Processed file paths didn't match expected `result/` folder

### Root Cause
**Filename Transformation Pipeline**: Multiple systems transformed filenames without a consistent naming convention or transformation tracking.

### How to Avoid

1. **Filename Convention Documentation**
   ```python
   # Document expected filename transformations:
   # 1. Upload:    "document.pdf"
   # 2. Sanitize:  "document_sanitized.pdf"
   # 3. Chunk:     "document_sanitized_chunk_0.pdf"
   # 4. Process:   "document_sanitized_chunk_0.pdf"
   # 5. Merge:     "COMPLIANT_document_sanitized.pdf"
   ```

2. **Robust Filename Parsing**
   ```python
   # Extract job_id from various formats
   def extract_job_id(s3_key):
       filename = s3_key.split('/')[-1]
       # Remove known suffixes
       filename = re.sub(r'_chunk_\d+', '', filename)
       filename = re.sub(r'\.pdf$', '', filename)
       return filename
   ```

3. **Path Consistency Testing**
   - Add integration tests for filename transformations
   - Validate S3 paths at each stage
   - Log filename transformations for debugging

---

## 6. CloudWatch Logs IAM Permissions (Commit e37f6d7)

### Problem
Lambda couldn't create CloudWatch log groups because logs permissions used specific resource ARNs instead of wildcards, plus two other issues (job_id extraction from chunked files, frontend using wrong S3 key).

### Root Cause
**Overly Restrictive IAM Policies**: IAM policy restricted CloudWatch Logs to specific ARNs, but Lambda needs wildcard permissions to create log groups dynamically.

### How to Avoid

1. **CloudWatch Logs Best Practices**
   ```typescript
   // ✅ Correct: Use wildcards for logs
   new PolicyStatement({
     actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
     resources: ['*'] // CloudWatch Logs requires wildcard
   });
   ```

2. **Separate AWS Service Permissions**
   - Group permissions by AWS service
   - Use separate policy statements for different services
   - Follow AWS service-specific permission patterns

3. **Frontend State Consistency**
   - Always use server-returned data as source of truth
   - Update frontend state with actual processed values
   - Don't assume filename transformations match expectations

---

## 7. S3 Keys vs Presigned URLs (Commit f6e8323)

### Problem
Download failed because `processedResult.url` contained an S3 key path (`result/COMPLIANT_filename.pdf`) instead of a presigned URL. Browsers cannot download directly from S3 keys.

### Root Cause
**Type Confusion**: The system stored S3 keys in a field named `url`, but the frontend expected actual HTTP URLs. No type checking or validation caught this mismatch.

### How to Avoid

1. **Explicit Field Naming**
   ```javascript
   // ❌ BAD - ambiguous
   const result = {
     url: "result/file.pdf"  // Is this a URL or S3 key?
   };

   // ✅ GOOD - explicit
   const result = {
     s3Key: "result/file.pdf",
     downloadUrl: null  // Generated on-demand
   };
   ```

2. **Generate URLs at Access Time**
   ```javascript
   const handleDownload = async () => {
     // Always generate presigned URL on demand
     const url = await generatePresignedUrl(result.s3Key, filename);
     window.open(url);
   };
   ```

3. **Type Safety**
   - Use TypeScript interfaces to distinguish S3 keys from URLs
   - Add runtime validation for URL formats
   - Document what each field contains (key vs URL vs ARN)

---

## Cross-Cutting Themes

### A. Testing Gaps

**Issues Found**: Nearly all bugs would have been caught by integration tests
- S3 event format mismatch
- Path mismatches between systems
- Download functionality failures

**Solution**:
```javascript
// Integration test example
describe('PDF Processing Pipeline', () => {
  it('should process uploaded PDF through complete workflow', async () => {
    // 1. Upload file
    const uploadResponse = await uploadPDF(testFile);

    // 2. Verify job creation
    const job = await getJob(uploadResponse.jobId);
    expect(job.status).toBe('PROCESSING');

    // 3. Wait for completion
    await waitForJobCompletion(job.id);

    // 4. Verify processed file exists
    const processedFile = await checkS3Key(job.result_s3_key);
    expect(processedFile).toBeDefined();

    // 5. Verify download works
    const url = await generateDownloadUrl(job.result_s3_key);
    expect(url).toMatch(/^https:/);
  });
});
```

### B. Documentation Deficits

**Issues Found**: Lack of documented contracts between systems
- Lambda input/output formats
- S3 path conventions
- Filename transformation rules
- IAM permission requirements

**Solution**:
Create architecture documentation including:
1. System integration diagram
2. S3 bucket structure and path conventions
3. Lambda function contracts (input/output)
4. State transition diagrams for job lifecycle
5. Common failure modes and debugging steps

### C. Configuration Management

**Issues Found**: Configuration scattered across multiple places
- CDK context not persisted
- Hard-coded paths in multiple files
- Environment variables not validated

**Solution**:
```javascript
// Centralized configuration with validation
export const validateConfig = () => {
  const required = [
    'PDF_BUCKET',
    'HTML_BUCKET',
    'REGION',
    'USER_POOL_ID'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(', ')}`);
  }
};

// Call validation at app startup
validateConfig();
```

### D. Error Visibility

**Issues Found**: Problems weren't caught until runtime in production
- No validation of IAM policies
- No S3 path validation
- No contract verification

**Solution**:
1. Add deployment smoke tests
2. Implement health check endpoints
3. Add CloudWatch alarms for Lambda errors
4. Create debugging dashboards

---

## Recommended Action Items

### Immediate (High Priority)

1. **Add Integration Tests**
   - Test complete upload-to-download workflow
   - Test job status transitions
   - Test error scenarios

2. **Document Contracts**
   - Lambda input/output formats
   - S3 path structure
   - Environment variable requirements

3. **Centralize Configuration**
   - Create shared constants file
   - Validate configuration at startup
   - Document all environment variables

### Short Term (Medium Priority)

4. **Add Type Safety**
   - Introduce TypeScript for Lambda functions
   - Add runtime validation with Zod or similar
   - Create shared type definitions

5. **Improve Observability**
   - Add structured logging
   - Create CloudWatch dashboards
   - Set up error alerting

6. **Code Review Checklist**
   - Verify useEffect dependencies
   - Check IAM policy wildcards
   - Validate S3 path consistency
   - Ensure Lambda contracts match

### Long Term (Low Priority)

7. **Architecture Documentation**
   - Create system architecture diagram
   - Document data flow between components
   - Map out all S3 paths and their purposes

8. **Automated Validation**
   - CDK unit tests for IAM policies
   - Pre-deployment validation scripts
   - Automated contract testing

---

## Summary

The 7 bug fixes reveal systematic issues rather than isolated mistakes:

1. **Contract mismatches** between integrated components
2. **Path convention inconsistencies** across the system
3. **React state management** anti-patterns
4. **IAM permission** misconfigurations
5. **Type confusion** between S3 keys and URLs
6. **Lack of integration testing** to catch cross-component issues
7. **Missing documentation** for system contracts and conventions

The common thread is **implicit assumptions** that weren't documented, validated, or tested. The solution is to make these assumptions explicit through documentation, type safety, validation, and comprehensive testing.
