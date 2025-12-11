import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CircularProgress, Snackbar, Alert } from '@mui/material';
import { startRemediation, getComplexityColor, getComplexityDisplayName } from '../utilities/analysisService';
import './AnalysisResultsSection.css';
import imgFileText from '../assets/pdf-icon.svg';

function AnalysisResultsSection({ analysis, onStartProcessing, onCancel, idToken }) {
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [openSnackbar, setOpenSnackbar] = useState(false);

  const handleStartProcessing = async () => {
    setIsStarting(true);
    setErrorMessage('');

    try {
      const result = await startRemediation(analysis.job_id, idToken);
      console.log('Remediation started:', result);

      // Call parent handler to transition to processing state
      onStartProcessing(analysis);
    } catch (error) {
      console.error('Error starting remediation:', error);
      setErrorMessage(error.message || 'Failed to start processing. Please try again.');
      setOpenSnackbar(true);
      setIsStarting(false);
    }
  };

  const handleCloseSnackbar = (_, reason) => {
    if (reason === 'clickaway') return;
    setOpenSnackbar(false);
  };

  if (!analysis) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="analysis-container">
          <div className="analysis-content">
            <CircularProgress />
            <p>Loading analysis results...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  const complexityColor = getComplexityColor(analysis.complexity);
  const complexityName = getComplexityDisplayName(analysis.complexity);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="analysis-container">
        <div className="analysis-content">
          <div className="analysis-header">
            <div className="file-icon">
              <img src={imgFileText} alt="PDF" />
            </div>
            <div className="analysis-title">
              <h2>PDF Analysis Complete</h2>
              <p className="file-name">{analysis.file_name}</p>
            </div>
          </div>

          <div className="analysis-stats">
            <div className="stat-card">
              <label>File Size</label>
              <value>{analysis.file_size_mb.toFixed(2)} MB</value>
            </div>

            <div className="stat-card">
              <label>Pages</label>
              <value>{analysis.num_pages}</value>
            </div>

            <div className="stat-card">
              <label>Complexity</label>
              <value style={{ color: complexityColor, fontWeight: 'bold' }}>
                {complexityName}
              </value>
            </div>
          </div>

          <div className="cost-analysis">
            <div className="cost-header">
              <h3>Estimated Processing Cost</h3>
            </div>

            <div className="cost-breakdown">
              <div className="cost-item highlight">
                <label>Adobe API Transactions:</label>
                <value>{analysis.estimated_transactions.toLocaleString()}</value>
              </div>

              <div className="cost-item highlight">
                <label>Cost Estimate:</label>
                <value>{analysis.estimated_cost_percentage.toFixed(2)}% of yearly quota</value>
              </div>

              <div className="cost-item">
                <label>Estimated Elements:</label>
                <value>{analysis.estimated_elements?.toLocaleString() || 'N/A'}</value>
              </div>
            </div>

            <div className="cost-explanation">
              <p>
                <strong>How we calculate this:</strong> Adobe charges 10 transactions per page.
                Your {analysis.num_pages}-page PDF will use{' '}
                {analysis.estimated_transactions.toLocaleString()} transaction{analysis.estimated_transactions !== 1 ? 's' : ''}.
              </p>
              {analysis.estimated_elements && (
                <p style={{ marginTop: '8px', fontSize: '14px', color: '#6b7280' }}>
                  <strong>Document complexity:</strong> This PDF contains approximately{' '}
                  {analysis.estimated_elements.toLocaleString()} structural elements
                  ({analysis.avg_elements_per_page?.toFixed(1) || 'N/A'} elements per page on average).
                  Documents with many elements may take longer to process but will use the same number of transactions.
                </p>
              )}
            </div>
          </div>

          {errorMessage && (
            <div className="analysis-error">
              <p>{errorMessage}</p>
            </div>
          )}

          <div className="analysis-actions">
            <button
              className="start-btn"
              onClick={handleStartProcessing}
              disabled={isStarting}
            >
              {isStarting ? (
                <>
                  <CircularProgress size={20} sx={{ color: '#000', marginRight: '10px' }} />
                  Starting...
                </>
              ) : (
                'Start Remediation Process'
              )}
            </button>

            <button
              className="cancel-btn"
              onClick={onCancel}
              disabled={isStarting}
            >
              Cancel
            </button>
          </div>

          <div className="disclaimer">
            <p>
              <strong>Note:</strong> This is an estimate based on PDF structure analysis.
              Actual Adobe API usage may vary slightly depending on document complexity.
            </p>
          </div>
        </div>

        {/* Snackbar for error messages */}
        <Snackbar
          open={openSnackbar}
          autoHideDuration={6000}
          onClose={handleCloseSnackbar}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Alert onClose={handleCloseSnackbar} severity="error" sx={{ width: '100%' }} elevation={6} variant="filled">
            {errorMessage}
          </Alert>
        </Snackbar>
      </div>
    </motion.div>
  );
}

export default AnalysisResultsSection;
