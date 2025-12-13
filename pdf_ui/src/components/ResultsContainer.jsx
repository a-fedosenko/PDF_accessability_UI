import React, { useState, useMemo, useCallback } from 'react';
import './ResultsContainer.css';
import img1 from "../assets/zap.svg";
import AccessibilityChecker from './AccessibilityChecker';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFBucket, region } from '../utilities/constants';

const ResultsContainer = ({
  fileName,
  processedResult,
  format,
  fileSize,
  processingTime,
  originalFileName,
  updatedFilename,
  awsCredentials,
  onNewUpload
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);

  // Initialize S3 client
  const s3 = useMemo(() => {
    if (!awsCredentials?.accessKeyId) {
      console.warn('AWS credentials not available yet');
      return null;
    }
    return new S3Client({
      region,
      credentials: {
        accessKeyId: awsCredentials.accessKeyId,
        secretAccessKey: awsCredentials.secretAccessKey,
        sessionToken: awsCredentials.sessionToken,
      },
    });
  }, [awsCredentials]);

  // Generate presigned URL for download
  const generatePresignedUrl = useCallback(async (key, filename) => {
    if (!s3) {
      throw new Error('S3 client not initialized');
    }
    const command = new GetObjectCommand({
      Bucket: PDFBucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    return await getSignedUrl(s3, command, { expiresIn: 30000 }); // 8.33 hour expiration
  }, [s3]);

  // Function to format processing time
  const formatProcessingTime = (seconds) => {
    if (!seconds || seconds < 0) return 'Processing completed';

    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const handleDownload = async () => {
    if (!processedResult || !format || !fileName) {
      alert('Download information not available');
      return;
    }

    setIsDownloading(true);
    try {
      console.log('Starting download for:', { fileName, format });

      // Check if processedResult.url is already a presigned URL or an S3 key
      let downloadUrl = processedResult.url;

      if (!downloadUrl) {
        throw new Error('No download URL received');
      }

      // If the URL is an S3 key (doesn't start with http), generate presigned URL
      if (!downloadUrl.startsWith('http')) {
        console.log('Generating presigned URL for S3 key:', downloadUrl);
        const desiredFilename = `COMPLIANT_${fileName}`;
        downloadUrl = await generatePresignedUrl(downloadUrl, desiredFilename);
      }

      console.log('Using download URL:', downloadUrl);

      // Method 1: Try window.open first (bypasses React Router)
      const downloadWindow = window.open(downloadUrl, '_blank');

      // Fallback: If popup blocked, use temporary link method
      if (!downloadWindow || downloadWindow.closed) {
        console.log('Popup blocked, using link method');

        // Method 2: Create temporary link and force download
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.target = '_blank';
        link.style.display = 'none';

        // Add to DOM, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // If window.open worked, close it after a short delay (the download should start)
        setTimeout(() => {
          if (downloadWindow && !downloadWindow.closed) {
            downloadWindow.close();
          }
        }, 1000);
      }

      console.log('Download initiated successfully');

    } catch (error) {
      console.error('Download failed:', error);

      // Provide more specific error messages
      let errorMessage = 'Download failed. Please try again.';

      if (error.message.includes('File not found')) {
        errorMessage = 'File not ready yet. Please wait for processing to complete.';
      } else if (error.message.includes('Access denied')) {
        errorMessage = 'Access denied. Please check permissions or contact support.';
      } else if (error.message.includes('credentials')) {
        errorMessage = 'Authentication error. Please refresh the page and try again.';
      }

      alert(errorMessage);
    } finally {
      setIsDownloading(false);
    }
  };


  return (
    <>
      <div className="results-container">
        <div className="results-content">
          <div className="results-header">
            <h2>PDF Remediation Successful</h2>
            <div className="flow-indicator">
              {format === 'html' ? 'PDF → HTML' : 'PDF → PDF'}
            </div>
          </div>

          <div className="processing-info">
            <div className="processing-time">
              <img alt="" className="block max-w-none size-full" src={img1} />
              <span>Total Processing Time: {formatProcessingTime(processingTime)}</span>
            </div>
            <p className="description">Your PDF has been successfully remediated for accessibility</p>
          </div>

          <div className="file-success-container">
            <div className="file-info-card">
              <div className="file-name-section">
                <div className="file-icon">
                  <img alt="" className="block max-w-none size-full" src={require("../assets/pdf-icon.svg")} />
                </div>
                <div className="file-details">
                  <div className="file-name">{fileName}</div>
                  <div className="file-status">File processed successfully</div>
                </div>
              </div>
            </div>
          </div>

          <div className="button-group">
            {format === 'pdf' && (
              <button className="view-report-btn" onClick={() => setShowReportDialog(true)}>
                View Report
              </button>
            )}
            <button
              className="download-btn"
              onClick={handleDownload}
              disabled={isDownloading || !processedResult}
              title={isDownloading ? 'Downloading...' : 'Download the processed file'}
            >
              {isDownloading ? 'Downloading...' : `Download ${format === 'html' ? 'ZIP' : 'PDF'} File`}
            </button>
          </div>

                        </div>

      {/* Accessibility Report Dialog - Only for PDF-PDF format */}
      {format === 'pdf' && (
        <AccessibilityChecker
          originalFileName={originalFileName || fileName}
          updatedFilename={updatedFilename}
          awsCredentials={awsCredentials}
          open={showReportDialog}
          onClose={() => setShowReportDialog(false)}
        />
      )}

        <div className="upload-new-section">
          <button className="upload-new-btn" onClick={onNewUpload}>
            Back to Main Page
          </button>
        </div>
      </div>
    </>
  );
};

export default ResultsContainer;
