// src/MainApp.js
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { Container, Box } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import Header from './components/Header';
import UploadSection from './components/UploadSection';
import AnalysisResultsSection from './components/AnalysisResultsSection';
import ProcessingContainer from './components/ProcessingContainer';
import ResultsContainer from './components/ResultsContainer';
import LeftNav from './components/LeftNav';
import theme from './theme';
import FirstSignInDialog from './components/FirstSignInDialog';
import HeroSection from './components/HeroSection';
import InformationBlurb from './components/InformationBlurb';
import './App.css';

import {
  Authority,
  CheckAndIncrementQuota,
  GetUserJobsEndpoint,
  GetJobEndpoint,
  CreateJobEndpoint,
  AnalyzeJobEndpoint,
  StartProcessingEndpoint,
  CancelJobEndpoint,
  DeleteJobEndpoint,
  EnablePreAnalysis,
  PDFBucket,
  region
} from './utilities/constants';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import CustomCredentialsProvider from './utilities/CustomCredentialsProvider';
import DeploymentPopup from './components/DeploymentPopup';
import { pollForAnalysis } from './utilities/analysisService';
import FileActionsSection from './components/FileActionsSection';
import JobHistoryTable from './components/JobHistoryTable';

function MainApp({ isLoggingOut, setIsLoggingOut }) {
  const auth = useAuth();
  const navigate = useNavigate();

  // AWS & file states
  const [awsCredentials, setAwsCredentials] = useState(null);
  const [currentPage, setCurrentPage] = useState('upload');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [processedResult, setProcessedResult] = useState(null);
  const [processingStartTime, setProcessingStartTime] = useState(null);

  // Analysis workflow states
  const [analysisData, setAnalysisData] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  // Job management states
  const [currentJob, setCurrentJob] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  // Centralized Usage State
  const [usageCount, setUsageCount] = useState(0);
  const [pdf2pdfCount, setPdf2pdfCount] = useState(0);
  const [pdf2htmlCount, setPdf2htmlCount] = useState(0);
  const [maxFilesAllowed, setMaxFilesAllowed] = useState(999999); // Default: unlimited (backend will override)
  const [maxPagesAllowed, setMaxPagesAllowed] = useState(10000); // Default: 10000 pages (backend will override)
  const [maxSizeAllowedMB, setMaxSizeAllowedMB] = useState(5120); // Default: 5GB (backend will override)
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [usageError, setUsageError] = useState('');

  // Deployment validation state
  const [showDeploymentPopup, setShowDeploymentPopup] = useState(false);
  const [bucketValidation, setBucketValidation] = useState(null);

  // Left navigation state
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Session recovery state - track if we've already recovered
  const [sessionRecovered, setSessionRecovered] = useState(false);

  // Job history state
  const [allJobs, setAllJobs] = useState([]);
  const [displayedJobs, setDisplayedJobs] = useState([]);
  const [jobsToShow, setJobsToShow] = useState(5);
  const [hasActiveJob, setHasActiveJob] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [startingJobId, setStartingJobId] = useState(null);


  // Fetch credentials once user is authenticated
  useEffect(() => {
    if (auth.isAuthenticated) {
      (async () => {
        try {
          const token = auth.user?.id_token;
          const domain = Authority;

          const customCredentialsProvider = new CustomCredentialsProvider();
          customCredentialsProvider.loadFederatedLogin({ domain, token });

          const { credentials: c } =
            await customCredentialsProvider.getCredentialsAndIdentityId();

          setAwsCredentials({
            accessKeyId: c.accessKeyId,
            secretAccessKey: c.secretAccessKey,
            sessionToken: c.sessionToken,
          });
        } catch (error) {
          console.error('Error fetching Cognito credentials:', error);
        }
      })();
    }
  }, [auth.isAuthenticated, auth.user]);

  // Monitor authentication status within MainApp
  useEffect(() => {
    if (!auth.isAuthenticated && !isLoggingOut) {
      // If user is not authenticated, redirect to /home
      navigate('/home', { replace: true });
    }
  }, [auth.isAuthenticated, isLoggingOut, navigate]);

  // FUNCTION: Fetch current usage from the backend (mode="check")
  const refreshUsage = useCallback(async () => {
    if (!auth.isAuthenticated) return; // not logged in yet
    setLoadingUsage(true);
    setUsageError('');

    const userSub = auth.user?.profile?.sub;
    if (!userSub) {
      setUsageError('User identifier not found.');
      setLoadingUsage(false);
      return;
    }

    try {
      const res = await fetch(CheckAndIncrementQuota, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.user?.id_token}`
        },
        body: JSON.stringify({ sub: userSub, mode: 'check' }),
      });

      if (!res.ok) {
        const errData = await res.json();
        setUsageError(errData.message || 'Error fetching usage');
        setLoadingUsage(false);
        return;
      }

      const data = await res.json();
      setUsageCount(data.currentUsage ?? 0);
      setPdf2pdfCount(data.pdf2pdfCount ?? 0);
      setPdf2htmlCount(data.pdf2htmlCount ?? 0);
      setMaxFilesAllowed(data.maxFilesAllowed ?? 999999);
      setMaxPagesAllowed(data.maxPagesAllowed ?? 10000);
      setMaxSizeAllowedMB(data.maxSizeAllowedMB ?? 5120);

    } catch (err) {
      setUsageError(`Failed to fetch usage: ${err.message}`);
    } finally {
      setLoadingUsage(false);
    }
  }, [auth.isAuthenticated, auth.user]);

  // FUNCTION: Initialize limits from ID token
  const initializeLimitsFromProfile = useCallback(() => {
    if (auth.isAuthenticated && auth.user?.profile) {
      const profile = auth.user.profile;

      const customMaxFiles = profile['custom:max_files_allowed'];
      const customMaxPages = profile['custom:max_pages_allowed'];
      const customMaxSizeMB = profile['custom:max_size_allowed_MB'];
      // console.log('Custom limits:', customMaxFiles, customMaxPages, customMaxSizeMB);
      if (customMaxFiles) setMaxFilesAllowed(parseInt(customMaxFiles, 10));
      if (customMaxPages) setMaxPagesAllowed(parseInt(customMaxPages, 10));
      if (customMaxSizeMB) setMaxSizeAllowedMB(parseInt(customMaxSizeMB, 10));
    }
  }, [auth.isAuthenticated, auth.user]);

  // Call refreshUsage whenever the user becomes authenticated
  useEffect(() => {
    if (auth.isAuthenticated) {
      initializeLimitsFromProfile();
      refreshUsage();
    }
  }, [auth.isAuthenticated, initializeLimitsFromProfile, refreshUsage]);

  // Bucket validation is now only checked when users select format options

  // Handler for showing deployment popup from child components
  const handleShowDeploymentPopup = (validation) => {
    setBucketValidation(validation);
    setShowDeploymentPopup(true);
  };

  // Handle events from child components - FIXED to show file-actions immediately
  const handleUploadComplete = async (updated_filename, original_fileName, format = 'pdf', jobId) => {
    console.log('=== UPLOAD COMPLETE ===');
    console.log('Upload completed, new file name:', updated_filename);
    console.log('Original file name:', original_fileName);
    console.log('Selected format:', format);
    console.log('Job ID:', jobId);

    const fileData = {
      name: original_fileName,
      updatedName: updated_filename,
      format: format,
      jobId: jobId,
      size: 0 // We'll get this from the upload component if needed
    };

    setUploadedFile(fileData);

    // CRITICAL FIX: Immediately fetch the job and show file-actions page
    // Do NOT automatically start analysis
    try {
      if (GetJobEndpoint && jobId) {
        const encodedJobId = encodeURIComponent(jobId);
        console.log('Fetching job from:', `${GetJobEndpoint}/${encodedJobId}`);

        const response = await fetch(`${GetJobEndpoint}/${encodedJobId}`, {
          headers: {
            Authorization: `Bearer ${auth.user?.id_token}`
          }
        });

        if (response.ok) {
          const job = await response.json();
          console.log('Job record fetched:', job);
          setCurrentJob(job);
          setJobStatus(job.status);

          // IMMEDIATELY show file-actions page - user chooses what to do next
          console.log('Setting page to file-actions');
          setCurrentPage('file-actions');
        } else {
          console.error('Failed to fetch job record:', response.status);
          // If job fetch fails, still show the page but with minimal info
          setCurrentJob({
            job_id: jobId,
            file_name: original_fileName,
            file_size_mb: 0,
            status: 'UPLOADED'
          });
          setCurrentPage('file-actions');
        }
      } else {
        console.error('GetJobEndpoint or jobId missing');
        setCurrentPage('upload');
      }
    } catch (error) {
      console.error('Error fetching job record:', error);
      setCurrentPage('upload');
    }

    // After a successful upload, refresh usage
    refreshUsage();
  };

  // Handle user starting remediation after seeing analysis
  const handleStartRemediation = (analysis) => {
    console.log('Starting remediation for analyzed PDF:', analysis);

    // Set uploadedFile data from analysis so ProcessingContainer can work
    setUploadedFile({
      name: analysis.file_name,
      updatedName: analysis.file_key || analysis.s3_key,
      format: 'pdf', // Default to PDF format
      jobId: analysis.job_id,
      size: analysis.file_size_mb || 0
    });

    setProcessingStartTime(Date.now());
    setCurrentPage('processing');

    // Start polling for job completion
    startPollingJob(analysis.job_id);
  };

  // Handle user canceling after seeing analysis
  const handleCancelAnalysis = () => {
    console.log('User canceled after analysis');
    setAnalysisData(null);
    setCurrentPage('upload');
    setUploadedFile(null);
  };

  const handleProcessingComplete = (result) => {
    // Calculate processing time
    const processingTime = processingStartTime
      ? Math.round((Date.now() - processingStartTime) / 1000) // Convert to seconds
      : null;

    setProcessedResult({ ...result, processingTime });
    setCurrentPage('results');
  };

  const handleNewUpload = () => {
    setCurrentPage('upload');
    setUploadedFile(null);
    setProcessedResult(null);
    setProcessingStartTime(null);
    setAnalysisData(null);
    setIsAnalyzing(false);
    setAnalysisError('');
    setCurrentJob(null);
    setJobStatus(null);

    // Refresh jobs list to show updated statuses
    refreshJobs();
  };

  // ========== NEW JOB MANAGEMENT HANDLERS ==========

  // FUNCTION: Start polling for job status changes
  const startPollingJob = useCallback((jobId) => {
    // Clear any existing polling interval
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }

    console.log('Starting polling for job:', jobId);

    const interval = setInterval(async () => {
      try {
        const encodedJobId = encodeURIComponent(jobId);
        const response = await fetch(`${GetJobEndpoint}/${encodedJobId}`, {
          headers: {
            Authorization: `Bearer ${auth.user?.id_token}`
          }
        });

        if (!response.ok) {
          console.error('Failed to fetch job status:', response.status);
          clearInterval(interval);
          setPollingInterval(null);
          return;
        }

        const job = await response.json();
        console.log('Job status update:', job.status);

        setCurrentJob(job);
        setJobStatus(job.status);

        // Stop polling when reaching a terminal or actionable state
        if (['ANALYSIS_COMPLETE', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
          console.log('Stopping polling - terminal state reached:', job.status);
          clearInterval(interval);
          setPollingInterval(null);

          // Update UI based on final status
          if (job.status === 'ANALYSIS_COMPLETE') {
            setAnalysisData(job);
            setCurrentPage('analysis-results');
          } else if (job.status === 'COMPLETED') {
            // Update uploadedFile with the actual s3_key from the job (needed for reports)
            setUploadedFile(prev => ({
              ...prev,
              updatedName: job.s3_key // Use the actual S3 key path from the job
            }));
            setProcessedResult({ url: job.processed_s3_key });
            setCurrentPage('results');
          } else if (job.status === 'FAILED') {
            setAnalysisError(job.error_message || 'Processing failed');
            setCurrentPage('upload');
          } else if (job.status === 'CANCELLED') {
            setCurrentPage('upload');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 3000); // Poll every 3 seconds

    setPollingInterval(interval);
  }, [auth.user, pollingInterval, GetJobEndpoint]);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  // FUNCTION: Handle "Check File" button - trigger analysis
  const handleCheckFile = async () => {
    if (!currentJob || !AnalyzeJobEndpoint) return;

    try {
      console.log('Starting file analysis for job:', currentJob.job_id);
      setCurrentPage('analyzing');
      setAnalysisError('');

      const response = await fetch(AnalyzeJobEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.user.id_token}`
        },
        body: JSON.stringify({ job_id: currentJob.job_id })
      });

      if (!response.ok) {
        throw new Error('Analysis request failed');
      }

      // Start polling for results
      startPollingJob(currentJob.job_id);
    } catch (error) {
      console.error('Failed to start analysis:', error);
      setAnalysisError(error.message || 'Failed to start analysis');
      setCurrentPage('file-actions');
    }
  };

  // FUNCTION: Handle "Start Processing" button from FileActionsSection
  const handleStartProcessingFromFileActions = async () => {
    if (!currentJob || !StartProcessingEndpoint) return;

    try {
      console.log('Starting processing for job:', currentJob.job_id);
      setCurrentPage('processing');
      setProcessingStartTime(Date.now());

      const response = await fetch(StartProcessingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.user.id_token}`
        },
        body: JSON.stringify({ job_id: currentJob.job_id })
      });

      if (!response.ok) {
        throw new Error('Failed to start processing');
      }

      // Start polling for completion
      startPollingJob(currentJob.job_id);
    } catch (error) {
      console.error('Failed to start processing:', error);
      setAnalysisError(error.message || 'Failed to start processing');
      setCurrentPage('file-actions');
    }
  };

  // FUNCTION: Handle cancel from FileActionsSection - mark job as CANCELLED
  const handleCancelFileActions = async () => {
    if (!currentJob) return;

    console.log('User canceled job:', currentJob.job_id);

    // Try to mark job as CANCELLED in backend
    // Note: If CancelJobEndpoint doesn't exist yet, we'll just clear local state
    if (CancelJobEndpoint) {
      try {
        const response = await fetch(CancelJobEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.user.id_token}`
          },
          body: JSON.stringify({
            job_id: currentJob.job_id,
            status: 'CANCELLED'
          })
        });

        if (!response.ok) {
          console.error('Failed to cancel job in backend:', response.status);
        }
      } catch (error) {
        console.error('Error canceling job:', error);
      }
    }

    // Clear local state and return to upload page
    setCurrentPage('upload');
    setUploadedFile(null);
    setCurrentJob(null);
    setJobStatus(null);
    setAnalysisData(null);
  };

  // FUNCTION: Handle job selection from job history table
  const handleSelectJob = useCallback((job, action) => {
    console.log('Job selected:', job.job_id, 'Action:', action);
    setCurrentJob(job);
    setJobStatus(job.status);

    switch (action) {
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
        handleStartProcessingFromTable(job);
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
        handleDownloadJob(job);
        break;

      case 'cancel':
        // Cancel ANALYZING or PROCESSING job
        handleCancelJob(job.job_id);
        break;

      case 'delete':
        // This shouldn't be called directly - delete is handled separately
        console.warn('Delete should be handled by handleDeleteJob');
        break;

      default:
        console.warn('Unknown action:', action);
    }
  }, []);

  // FUNCTION: Handle "Start Processing" from job table
  const handleStartProcessingFromTable = async (job) => {
    if (!StartProcessingEndpoint) return;

    try {
      console.log('Starting processing for job from table:', job.job_id);
      setStartingJobId(job.job_id);

      // Set up the uploadedFile data needed for ProcessingContainer
      setUploadedFile({
        name: job.file_name,
        updatedName: job.s3_key,
        format: 'pdf',
        jobId: job.job_id,
        size: job.file_size_mb
      });

      setProcessingStartTime(Date.now());
      setCurrentPage('processing');

      const response = await fetch(StartProcessingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.user.id_token}`
        },
        body: JSON.stringify({ job_id: job.job_id })
      });

      if (!response.ok) {
        throw new Error('Failed to start processing');
      }

      // Start polling for completion
      startPollingJob(job.job_id);

      // Update job status in local state to PROCESSING
      setAllJobs(prev => prev.map(j =>
        j.job_id === job.job_id ? { ...j, status: 'PROCESSING' } : j
      ));
      setDisplayedJobs(prev => prev.map(j =>
        j.job_id === job.job_id ? { ...j, status: 'PROCESSING' } : j
      ));

      // Re-check active jobs
      checkForActiveJobs();
    } catch (error) {
      console.error('Failed to start processing:', error);
      setAnalysisError(error.message || 'Failed to start processing');
      setCurrentPage('upload');
    } finally {
      setStartingJobId(null);
    }
  };

  // FUNCTION: Handle download from job table
  const handleDownloadJob = async (job) => {
    if (!job.processed_s3_key) {
      console.error('No processed file available for download');
      alert('No processed file available for this job.');
      return;
    }

    if (!awsCredentials?.accessKeyId) {
      console.error('AWS credentials not available');
      alert('Initializing download... Please wait a moment and try again.');
      return;
    }

    try {
      console.log('Downloading job:', job.job_id, 'S3 key:', job.processed_s3_key);

      // Create S3 client
      const s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId: awsCredentials.accessKeyId,
          secretAccessKey: awsCredentials.secretAccessKey,
          sessionToken: awsCredentials.sessionToken,
        },
      });

      // Generate presigned URL
      const command = new GetObjectCommand({
        Bucket: PDFBucket,
        Key: job.processed_s3_key,
        ResponseContentDisposition: `attachment; filename="COMPLIANT_${job.file_name}"`,
      });

      const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      console.log('Generated download URL');

      // Trigger download
      const downloadWindow = window.open(downloadUrl, '_blank');

      // Fallback if popup blocked
      if (!downloadWindow || downloadWindow.closed) {
        console.log('Popup blocked, using link method');
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.target = '_blank';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // Close popup after download starts
        setTimeout(() => {
          if (downloadWindow && !downloadWindow.closed) {
            downloadWindow.close();
          }
        }, 1000);
      }

      console.log('Download initiated successfully');
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed. Please try again or use the View Result button to access the file.');
    }
  };

  // FUNCTION: Handle job cancellation from table
  const handleCancelJob = async (jobId) => {
    if (!CancelJobEndpoint) return;

    try {
      console.log('Canceling job:', jobId);

      const response = await fetch(CancelJobEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.user.id_token}`
        },
        body: JSON.stringify({
          job_id: jobId,
          status: 'CANCELLED'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to cancel job');
      }

      // Update local job list
      setAllJobs(prev => prev.map(j =>
        j.job_id === jobId ? { ...j, status: 'CANCELLED' } : j
      ));
      setDisplayedJobs(prev => prev.map(j =>
        j.job_id === jobId ? { ...j, status: 'CANCELLED' } : j
      ));

      // Re-check active jobs
      checkForActiveJobs();

      console.log('Job cancelled successfully');
    } catch (error) {
      console.error('Error canceling job:', error);
    }
  };

  // FUNCTION: Handle job deletion
  const handleDeleteJob = async (jobId) => {
    if (!DeleteJobEndpoint) {
      console.error('DeleteJobEndpoint not configured');
      return;
    }

    try {
      console.log('Deleting job:', jobId);

      const response = await fetch(`${DeleteJobEndpoint}/${jobId}`, {
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

      const result = await response.json();
      console.log('Job deleted successfully:', result);

      // Remove from local state
      setAllJobs(prev => prev.filter(j => j.job_id !== jobId));
      setDisplayedJobs(prev => prev.filter(j => j.job_id !== jobId));

      // Update active job status
      checkForActiveJobs();
    } catch (error) {
      console.error('Error deleting job:', error);
      throw error; // Re-throw so JobHistoryTable can handle it
    }
  };

  // FUNCTION: Load more jobs
  const handleLoadMoreJobs = () => {
    const newCount = jobsToShow + 10;
    setJobsToShow(newCount);
    setDisplayedJobs(allJobs.slice(0, newCount));
  };

  // FUNCTION: Check if user has active jobs
  const checkForActiveJobs = useCallback(() => {
    const active = allJobs.some(job =>
      ['ANALYZING', 'PROCESSING'].includes(job.status)
    );
    setHasActiveJob(active);
  }, [allJobs]);

  // Update active job check when allJobs changes
  useEffect(() => {
    checkForActiveJobs();
  }, [allJobs, checkForActiveJobs]);

  // FUNCTION: Refresh jobs list from API
  const refreshJobs = useCallback(async () => {
    if (!auth.isAuthenticated || !GetUserJobsEndpoint) return;

    try {
      console.log('Refreshing jobs list...');
      setLoadingJobs(true);

      const response = await fetch(GetUserJobsEndpoint, {
        headers: {
          Authorization: `Bearer ${auth.user.id_token}`
        }
      });

      if (!response.ok) {
        console.error('Failed to fetch user jobs:', response.statusText);
        setLoadingJobs(false);
        return;
      }

      const data = await response.json();
      console.log('Jobs refreshed:', data);

      if (data.jobs && data.jobs.length > 0) {
        // Store all jobs
        setAllJobs(data.jobs);
        // Maintain current display limit (jobsToShow)
        setDisplayedJobs(data.jobs.slice(0, jobsToShow));

        // Check if there's an active job (ANALYZING or PROCESSING only)
        const activeJob = data.jobs.find(job =>
          ['ANALYZING', 'PROCESSING'].includes(job.status)
        );

        setHasActiveJob(!!activeJob);
        if (activeJob) {
          console.log('Active job in progress:', activeJob.job_id, activeJob.status);
        }
      } else {
        // No jobs found
        setAllJobs([]);
        setDisplayedJobs([]);
        setHasActiveJob(false);
      }

      setLoadingJobs(false);
    } catch (error) {
      console.error('Failed to refresh jobs:', error);
      setLoadingJobs(false);
    }
  }, [auth.isAuthenticated, auth.user, GetUserJobsEndpoint, jobsToShow]);

  // FUNCTION: Session Recovery - Fetch user's active jobs on mount
  const recoverSession = useCallback(async () => {
    if (!auth.isAuthenticated || !GetUserJobsEndpoint || sessionRecovered) return;

    try {
      console.log('Recovering session - fetching user jobs...');
      setSessionRecovered(true);
      setLoadingJobs(true);

      const response = await fetch(GetUserJobsEndpoint, {
        headers: {
          Authorization: `Bearer ${auth.user.id_token}`
        }
      });

      if (!response.ok) {
        console.error('Failed to fetch user jobs:', response.statusText);
        setLoadingJobs(false);
        return;
      }

      const data = await response.json();
      console.log('User jobs fetched:', data);

      if (data.jobs && data.jobs.length > 0) {
        // Store all jobs
        setAllJobs(data.jobs);
        setDisplayedJobs(data.jobs.slice(0, 5)); // Show first 5

        // Check if there's an active job (ANALYZING or PROCESSING only)
        const activeJob = data.jobs.find(job =>
          ['ANALYZING', 'PROCESSING'].includes(job.status)
        );

        if (activeJob) {
          setHasActiveJob(true);
          console.log('Active job in progress:', activeJob.job_id, activeJob.status);
        }

        // Always stay on upload page - no auto-navigation
        setCurrentPage('upload');
      }

      setLoadingJobs(false);
    } catch (error) {
      console.error('Session recovery failed:', error);
      setLoadingJobs(false);
    }
  }, [auth.isAuthenticated, auth.user, GetUserJobsEndpoint, sessionRecovered]);

  // Session recovery on mount
  useEffect(() => {
    if (auth.isAuthenticated && awsCredentials && GetUserJobsEndpoint) {
      recoverSession();
    }
  }, [auth.isAuthenticated, awsCredentials, recoverSession, GetUserJobsEndpoint]);

  // ========== END NEW JOB MANAGEMENT HANDLERS ==========

  // Handle authentication loading and errors
  if (auth.isLoading) {
    return <div>Loading...</div>;
  }

  if (auth.error) {
    // Example: handle "No matching state found" error
    if (auth.error.message.includes('No matching state found')) {
      console.log('Detected invalid or mismatched OIDC state. Redirecting to login...');
      auth.removeUser().then(() => {
        auth.signinRedirect();
      });
      return null;
    }
    return <div>Encountered error: {auth.error.message}</div>;
  }

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ minHeight: '100vh', backgroundColor: '#f4f6f8' }}>
        <LeftNav 
          isCollapsed={isNavCollapsed} 
          setIsCollapsed={setIsNavCollapsed}
          mobileOpen={mobileNavOpen}
          setMobileOpen={setMobileNavOpen}
        />

        <Box sx={{ 
          padding: { xs: 2, sm: 3 }, 
          paddingLeft: { xs: 2, md: isNavCollapsed ? '90px' : '390px' }, 
          transition: 'padding-left 0.3s ease',
          minHeight: '100vh'
        }}>
          <Header
            handleSignOut={() => auth.removeUser()}
            onMenuClick={() => setMobileNavOpen(true)}
          />

          {
          /* DISABLE FIRST SIGN IN DETAILS
          <FirstSignInDialog />
          */
          }

          {/* Deployment popup for bucket configuration - only shown when triggered */}
          {showDeploymentPopup && bucketValidation && (
            <DeploymentPopup
              open={showDeploymentPopup}
              onClose={() => setShowDeploymentPopup(false)}
              validation={bucketValidation}
            />
          )}

          <HeroSection />

          <Container maxWidth="lg" sx={{ marginTop: 0, padding: { xs: 0, sm: 1 } }}>

            {currentPage === 'upload' && (
              <>
                <UploadSection
                  onUploadComplete={handleUploadComplete}
                  awsCredentials={awsCredentials}
                  currentUsage={usageCount}
                  maxFilesAllowed={maxFilesAllowed}
                  maxPagesAllowed={maxPagesAllowed}
                  maxSizeAllowedMB={maxSizeAllowedMB}
                  onUsageRefresh={refreshUsage}
                  setUsageCount={setUsageCount}
                  isFileUploaded={!!uploadedFile}
                  onShowDeploymentPopup={handleShowDeploymentPopup}
                  hasActiveJob={hasActiveJob}
                />

                {/* Job History Table */}
                <JobHistoryTable
                  jobs={displayedJobs}
                  onSelectJob={handleSelectJob}
                  onDeleteJob={handleDeleteJob}
                  onLoadMore={handleLoadMoreJobs}
                  hasMore={displayedJobs.length < allJobs.length}
                  loading={loadingJobs}
                  startingJobId={startingJobId}
                />
              </>
            )}

            {currentPage === 'file-actions' && currentJob && (
              <FileActionsSection
                jobData={currentJob}
                onCheckFile={handleCheckFile}
                onStartProcessing={handleStartProcessingFromFileActions}
                onCancel={handleCancelFileActions}
                enableAnalysis={EnablePreAnalysis}
                loading={false}
              />
            )}

            {currentPage === 'analyzing' && (
              <Box sx={{ textAlign: 'center', padding: 4 }}>
                <h2>Analyzing your PDF...</h2>
                <p>Please wait while we analyze the document structure and estimate processing costs.</p>
                <Box sx={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                  <div className="spinner" style={{
                    border: '4px solid #f3f3f3',
                    borderTop: '4px solid #FFC627',
                    borderRadius: '50%',
                    width: '50px',
                    height: '50px',
                    animation: 'spin 1s linear infinite'
                  }}></div>
                </Box>
              </Box>
            )}

            {currentPage === 'analysis-results' && analysisData && (
              <AnalysisResultsSection
                analysis={analysisData}
                onStartProcessing={handleStartRemediation}
                onCancel={handleCancelAnalysis}
                idToken={auth.user?.id_token}
              />
            )}

            {currentPage === 'processing' && uploadedFile && (
              <ProcessingContainer
                originalFileName={uploadedFile.name}
                updatedFilename={uploadedFile.updatedName}
                onFileReady={(downloadUrl) => handleProcessingComplete({ url: downloadUrl })}
                awsCredentials={awsCredentials}
                selectedFormat={uploadedFile.format}
                onNewUpload={handleNewUpload}
              />
            )}

            {currentPage === 'processing' && !uploadedFile && (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <p>Loading processing page...</p>
              </div>
            )}

            {currentPage === 'results' && (
              <ResultsContainer
                fileName={uploadedFile?.name}
                processedResult={processedResult}
                format={uploadedFile?.format}
                processingTime={processedResult?.processingTime}
                originalFileName={uploadedFile?.name}
                updatedFilename={uploadedFile?.updatedName}
                awsCredentials={awsCredentials}
                onNewUpload={handleNewUpload}
              />
            )}


          </Container>

          <Box sx={{ marginTop: 8 }}>
            <InformationBlurb />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default MainApp;
