import React from 'react';
import { motion } from 'framer-motion';
import imgFileText from '../assets/pdf-icon.svg';
import './FileActionsSection.css';

/**
 * FileActionsSection Component
 * Displays uploaded file information and action buttons for analysis or direct processing
 *
 * @param {Object} props
 * @param {Object} props.jobData - Job object from DynamoDB containing file information
 * @param {Function} props.onCheckFile - Handler for "Check File" button (triggers analysis)
 * @param {Function} props.onStartProcessing - Handler for "Start Processing" button (skip analysis)
 * @param {Function} props.onCancel - Handler for "Cancel" button (return to upload)
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
  if (!jobData) {
    return null;
  }

  const { file_name, file_size_mb } = jobData;
  const isLargeFile = file_size_mb > 10;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
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
              <span className="file-size-display">{file_size_mb.toFixed(2)} MB</span>
            </div>
          </div>

          {isLargeFile && (
            <div className="file-warning">
              <p>
                <strong>Large file detected ({file_size_mb.toFixed(2)} MB).</strong>
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
              onClick={onStartProcessing}
              disabled={loading}
            >
              Start Processing
            </button>
            <button
              className="cancel-btn"
              onClick={onCancel}
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
    </motion.div>
  );
};

export default FileActionsSection;
