import React, { useState } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Button,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Cancel as CancelIcon,
  Assessment as AssessmentIcon,
  CheckCircle as CheckCircleIcon,
  Download as DownloadIcon,
  Visibility as VisibilityIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';

const JobHistoryTable = ({
  jobs = [],
  onSelectJob,
  onDeleteJob,
  onLoadMore,
  hasMore,
  loading,
  startingJobId = null,
}) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState(null);
  const [deletingJobId, setDeletingJobId] = useState(null);

  // Status badge colors
  const getStatusColor = (status) => {
    const colors = {
      UPLOADED: '#2196F3',      // Blue
      ANALYZING: '#FF9800',     // Orange
      ANALYSIS_COMPLETE: '#9C27B0', // Purple
      PROCESSING: '#FF9800',    // Orange
      COMPLETED: '#4CAF50',     // Green
      FAILED: '#F44336',        // Red
      CANCELLED: '#757575',     // Gray
    };
    return colors[status] || '#757575';
  };

  // Format file size
  const formatFileSize = (sizeInMB) => {
    if (!sizeInMB) return 'N/A';
    if (sizeInMB < 1) return `${(sizeInMB * 1024).toFixed(0)} KB`;
    return `${sizeInMB.toFixed(2)} MB`;
  };

  // Format created date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch (error) {
      return 'N/A';
    }
  };

  // Get action buttons based on status
  const getActionButtons = (job) => {
    const { status, job_id } = job;

    switch (status) {
      case 'UPLOADED':
        return (
          <>
            <Tooltip title="Resume">
              <IconButton
                size="small"
                color="primary"
                onClick={() => onSelectJob(job, 'resume')}
              >
                <PlayIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                color="error"
                onClick={() => handleDeleteClick(job)}
                disabled={deletingJobId === job_id}
              >
                {deletingJobId === job_id ? <CircularProgress size={20} /> : <DeleteIcon />}
              </IconButton>
            </Tooltip>
          </>
        );

      case 'ANALYZING':
        return (
          <>
            <Tooltip title="View (in progress)">
              <span>
                <IconButton size="small" disabled>
                  <VisibilityIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Cancel">
              <IconButton
                size="small"
                color="warning"
                onClick={() => onSelectJob(job, 'cancel')}
              >
                <CancelIcon />
              </IconButton>
            </Tooltip>
          </>
        );

      case 'ANALYSIS_COMPLETE':
        return (
          <>
            <Tooltip title="View Analysis">
              <IconButton
                size="small"
                color="primary"
                onClick={() => onSelectJob(job, 'view-analysis')}
                disabled={startingJobId === job_id}
              >
                <AssessmentIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Start Processing">
              <IconButton
                size="small"
                color="success"
                onClick={() => onSelectJob(job, 'start-processing')}
                disabled={startingJobId === job_id}
              >
                {startingJobId === job_id ? <CircularProgress size={20} /> : <PlayIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                color="error"
                onClick={() => handleDeleteClick(job)}
                disabled={deletingJobId === job_id || startingJobId === job_id}
              >
                {deletingJobId === job_id ? <CircularProgress size={20} /> : <DeleteIcon />}
              </IconButton>
            </Tooltip>
          </>
        );

      case 'PROCESSING':
        return (
          <>
            <Tooltip title="View (in progress)">
              <span>
                <IconButton size="small" disabled>
                  <VisibilityIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Cancel">
              <IconButton
                size="small"
                color="warning"
                onClick={() => onSelectJob(job, 'cancel')}
              >
                <CancelIcon />
              </IconButton>
            </Tooltip>
          </>
        );

      case 'COMPLETED':
        return (
          <>
            <Tooltip title="View Result">
              <IconButton
                size="small"
                color="primary"
                onClick={() => onSelectJob(job, 'view-result')}
              >
                <CheckCircleIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Download">
              <IconButton
                size="small"
                color="success"
                onClick={() => onSelectJob(job, 'download')}
              >
                <DownloadIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                color="error"
                onClick={() => handleDeleteClick(job)}
                disabled={deletingJobId === job_id}
              >
                {deletingJobId === job_id ? <CircularProgress size={20} /> : <DeleteIcon />}
              </IconButton>
            </Tooltip>
          </>
        );

      case 'FAILED':
      case 'CANCELLED':
        return (
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={() => handleDeleteClick(job)}
              disabled={deletingJobId === job_id}
            >
              {deletingJobId === job_id ? <CircularProgress size={20} /> : <DeleteIcon />}
            </IconButton>
          </Tooltip>
        );

      default:
        return null;
    }
  };

  // Handle delete button click
  const handleDeleteClick = (job) => {
    setJobToDelete(job);
    setDeleteDialogOpen(true);
  };

  // Handle delete confirmation
  const handleConfirmDelete = async () => {
    if (!jobToDelete) return;

    setDeletingJobId(jobToDelete.job_id);
    setDeleteDialogOpen(false);

    try {
      await onDeleteJob(jobToDelete.job_id);
    } catch (error) {
      console.error('Error deleting job:', error);
    } finally {
      setDeletingJobId(null);
      setJobToDelete(null);
    }
  };

  // Handle cancel delete
  const handleCancelDelete = () => {
    setDeleteDialogOpen(false);
    setJobToDelete(null);
  };

  // Empty state
  if (jobs.length === 0 && !loading) {
    return (
      <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          No jobs yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Upload your first PDF to get started
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h6" gutterBottom>
        Job History
      </Typography>

      {loading && jobs.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Filename</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Info</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Created</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }} align="right">
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow
                    key={job.job_id}
                    hover
                    sx={{
                      '&:last-child td, &:last-child th': { border: 0 },
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                        {job.file_name || 'Unknown'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={job.status || 'UNKNOWN'}
                        size="small"
                        sx={{
                          backgroundColor: getStatusColor(job.status),
                          color: 'white',
                          fontWeight: 'bold',
                        }}
                      />
                      {(job.status === 'ANALYZING' || job.status === 'PROCESSING') && (
                        <CircularProgress
                          size={16}
                          sx={{ ml: 1, verticalAlign: 'middle' }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatFileSize(job.file_size_mb)}
                        {job.page_count && ` • ${job.page_count} pages`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(job.created_at)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                        {getActionButtons(job)}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {hasMore && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Button
                variant="outlined"
                startIcon={<ExpandMoreIcon />}
                onClick={onLoadMore}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Show More'}
              </Button>
            </Box>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={handleCancelDelete}>
        <DialogTitle>Delete Job?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>"{jobToDelete?.file_name}"</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            This will remove the job record and all associated files from storage.
          </Typography>
          <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDelete}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JobHistoryTable;
