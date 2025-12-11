import React, { useState } from 'react';
import imgFileText from '../assets/pdf-icon.svg';
import './FileActionsSection.css';

/**
 * FileActionsSection Component
 * Displays uploaded file information and action buttons for analysis or direct processing
 *
 * @param {Object} props
 * @param {Object} props.jobData - Job object containing file information
 * @param {Function} props.onCheckFile - Handler for "Check File" button (triggers analysis)
 * @param {Function} props.onStartProcessing - Handler for "Start Processing" button
 * @param {Function} props.onCancel - Handler for "Cancel" button
 * @param {boolean} props.enableAnalysis - Feature flag to show/hide "Check File" button
 * @param {boolean} props.loading - Loading state for buttons
 */
const FileActionsSection = ({
  jobData,
  onCheckFile,
  onStartProcessing,
  onCancel,
  enableAnalysis = true,
  loading = false
}) => {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showProcessConfirm, setShowProcessConfirm] = useState(false);

  if (!jobData) {
    return null;
  }

  const { file_name, file_size_mb } = jobData;
  // Ensure file_size_mb is a number (DynamoDB may return it as a string)
  const fileSizeMb = parseFloat(file_size_mb) || 0;
  const isLargeFile = fileSizeMb > 10;

  const handleCancelClick = () => {
    setShowCancelConfirm(true);
  };

  const handleProcessClick = () => {
    setShowProcessConfirm(true);
  };

  const confirmCancel = () => {
    setShowCancelConfirm(false);
    onCancel();
  };

  const confirmProcess = () => {
    setShowProcessConfirm(false);
    onStartProcessing();
  };

  return (
    <div className="file-actions-wrapper">
      <div className="file-actions-container">
        <div className="file-actions-content">
          <div className="file-actions-header">
            <div className="file-icon">
              <img src={imgFileText} alt="" />
            </div>
            <div className="file-actions-title">
              <h2>PDF Accessibility Remediation</h2>
            </div>
          </div>

          <div className="file-info-section">
            <div className="file-details">
              <span className="file-name-display">{file_name}</span>
              <span className="file-size-display">{fileSizeMb.toFixed(2)} MB</span>
            </div>
          </div>

          {isLargeFile && (
            <div className="file-warning">
              <p>
                <strong>Large file detected ({fileSizeMb.toFixed(2)} MB).</strong>
                <br />
                Processing may take longer and consume more quota.
              </p>
            </div>
          )}

          <div className="file-actions-instructions">
            <p className="file-actions-main-text">
              Your file has been uploaded successfully. Choose an option below:
            </p>
          </div>

          <div className="file-actions-buttons">
            {enableAnalysis && (
              <button
                className="check-file-btn"
                onClick={onCheckFile}
                disabled={loading}
              >
                Check File
              </button>
            )}
            <button
              className="start-processing-btn"
              onClick={handleProcessClick}
              disabled={loading}
            >
              Start Processing
            </button>
            <button
              className="cancel-btn"
              onClick={handleCancelClick}
              disabled={loading}
            >
              Cancel
            </button>
          </div>

          <div className="file-actions-help">
            {enableAnalysis && (
              <p>
                <strong>Check File:</strong> Analyze the PDF to estimate processing time and cost.
                <br />
                <strong>Start Processing:</strong> Skip analysis and begin remediation immediately.
                <br />
                <strong>Cancel:</strong> Return to upload a different file.
              </p>
            )}
            {!enableAnalysis && (
              <p>
                Click "Start Processing" to begin PDF remediation or "Cancel" to upload a different file.
              </p>
            )}
          </div>
        </div>

        <div className="disclaimer">
          <p>This solution does not remediate for fillable forms and color selection/ contrast for people with color blindness</p>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {showCancelConfirm && (
        <div className="confirmation-overlay" onClick={() => setShowCancelConfirm(false)}>
          <div className="confirmation-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Cancel Job</h3>
            <p>Are you sure you want to cancel this job? This action cannot be undone.</p>
            <div className="confirmation-buttons">
              <button className="confirm-btn-secondary" onClick={() => setShowCancelConfirm(false)}>
                No, Keep Job
              </button>
              <button className="confirm-btn-primary" onClick={confirmCancel}>
                Yes, Cancel Job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Process Confirmation Dialog */}
      {showProcessConfirm && (
        <div className="confirmation-overlay" onClick={() => setShowProcessConfirm(false)}>
          <div className="confirmation-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Start Processing</h3>
            <p>Are you sure you want to start processing this PDF? This will consume your quota.</p>
            <div className="confirmation-buttons">
              <button className="confirm-btn-secondary" onClick={() => setShowProcessConfirm(false)}>
                No, Go Back
              </button>
              <button className="confirm-btn-primary" onClick={confirmProcess}>
                Yes, Start Processing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileActionsSection;
