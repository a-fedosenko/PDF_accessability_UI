import React from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Alert,
  Stack
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import SearchIcon from '@mui/icons-material/Search';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import WarningIcon from '@mui/icons-material/Warning';

/**
 * FileActionsSection Component
 * Displays uploaded file information and action buttons for analysis or direct processing
 *
 * @param {Object} props
 * @param {Object} props.jobData - Job object from DynamoDB containing file information
 * @param {Function} props.onCheckFile - Handler for "Check File" button (triggers analysis)
 * @param {Function} props.onStartProcessing - Handler for "Start Processing" button (skip analysis)
 * @param {boolean} props.enableAnalysis - Feature flag to show/hide "Check File" button
 * @param {boolean} props.loading - Loading state for buttons
 */
const FileActionsSection = ({
  jobData,
  onCheckFile,
  onStartProcessing,
  enableAnalysis = true,
  loading = false
}) => {
  if (!jobData) {
    return null;
  }

  const { file_name, file_size_mb } = jobData;
  const isLargeFile = file_size_mb > 10;

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
        padding: 3
      }}
    >
      <Paper
        elevation={3}
        sx={{
          padding: 4,
          maxWidth: 600,
          width: '100%',
          textAlign: 'center'
        }}
      >
        {/* File Icon and Name */}
        <Box sx={{ mb: 3 }}>
          <DescriptionIcon
            sx={{
              fontSize: 64,
              color: 'primary.main',
              mb: 2
            }}
          />
          <Typography variant="h5" gutterBottom>
            {file_name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Size: {file_size_mb.toFixed(2)} MB
          </Typography>
        </Box>

        {/* Large File Warning */}
        {isLargeFile && (
          <Alert
            severity="warning"
            icon={<WarningIcon />}
            sx={{ mb: 3, textAlign: 'left' }}
          >
            <Typography variant="body2">
              <strong>Large file detected ({file_size_mb.toFixed(2)} MB).</strong>
              <br />
              Processing may take longer and consume more quota.
            </Typography>
          </Alert>
        )}

        {/* Information Text */}
        <Typography variant="body1" sx={{ mb: 4 }} color="text.secondary">
          Your file has been uploaded successfully. Choose an option below:
        </Typography>

        {/* Action Buttons */}
        <Stack spacing={2}>
          {enableAnalysis && (
            <Button
              variant="outlined"
              size="large"
              startIcon={<SearchIcon />}
              onClick={onCheckFile}
              disabled={loading}
              fullWidth
            >
              Check File
            </Button>
          )}

          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrowIcon />}
            onClick={onStartProcessing}
            disabled={loading}
            fullWidth
          >
            Start Processing
          </Button>
        </Stack>

        {/* Help Text */}
        <Box sx={{ mt: 3 }}>
          {enableAnalysis && (
            <Typography variant="caption" color="text.secondary">
              <strong>Check File:</strong> Analyze the PDF to estimate processing time and cost.
              <br />
              <strong>Start Processing:</strong> Skip analysis and begin remediation immediately.
            </Typography>
          )}
          {!enableAnalysis && (
            <Typography variant="caption" color="text.secondary">
              Click "Start Processing" to begin PDF remediation.
            </Typography>
          )}
        </Box>
      </Paper>
    </Box>
  );
};

export default FileActionsSection;
