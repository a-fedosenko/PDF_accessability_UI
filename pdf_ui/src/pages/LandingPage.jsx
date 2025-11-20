import React, { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';

// MUI Components
import {
  Box,
  Typography,
  Link,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,

} from '@mui/material';
import LoadingButton from '@mui/lab/LoadingButton';
import CircularProgress from '@mui/material/CircularProgress';

// MUI Icons
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import CloseIcon from '@mui/icons-material/Close';

// Images
import asuLogo from '../assets/ASU_CIC_LOGO_WHITE.png';
import gradientImg from '../assets/Gradient.svg';
import awsLogo from '../assets/POWERED_BY_AWS.png';
import bottomGradient from '../assets/bottom_gradient.svg';

// Styled Components
import { styled } from '@mui/system';

const StyledLink = styled(Link)(({ theme }) => ({
  color: '#8C1D40',
  textDecoration: 'underline',
  component: 'a',
  '&:hover': {
    color: '#70122F',
  },
}));

const StyledEmailLink = styled(Link)(({ theme }) => ({
  color: '#8C1D40',
  textDecoration: 'none',
  component: 'a',
  '&:hover': {
    color: '#70122F',
    textDecoration: 'underline',
  },
}));

const GradientBox = styled(Box)(({ theme }) => ({
  backgroundImage: `url(${gradientImg})`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'center',
  backgroundSize: 'cover',
  padding: theme.spacing(8),
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: theme.spacing(1),
}));

const LandingPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);

  useEffect(() => {
    if (auth.isLoading) return;
    if (auth.isAuthenticated) {
      navigate('/app', { replace: true });
    }
  }, [auth.isLoading, auth.isAuthenticated, navigate]);

  const handleSignIn = () => {
    setLoading(true);
    // Introduce a 1-second delay before redirecting
    setTimeout(() => {
      auth.signinRedirect();
      // No need to reset loading here as redirect will occur
    }, 1000);
  };

  const handleOpenDialog = () => {
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
  };

  if (auth.isLoading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress size={50} thickness={5} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: '#fff',
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Black Bar */}
      <Box
        sx={{
          backgroundColor: '#000',
          height: '36px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />

      {/* Bottom Gradient */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          top: '50%',
          backgroundImage: `url(${bottomGradient})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover',
          zIndex: -1,
        }}
      />

      {/* Black Section with Main Content */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          backgroundColor: '#000',
          color: '#fff',
          minHeight: '65vh',
          alignItems: 'center',
          pb: 4,
          flexGrow: 1,
          flexWrap: 'wrap',
        }}
      >
        {/* Left Side: Text */}
        <Box
          sx={{
            flex: 1,
            padding: '0 4%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-start',
            minWidth: '300px',
          }}
        >
          <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', mb: 2 }}>
            PDF Accessibility Remediation
          </Typography>

          <Typography variant="h5" component="h2" sx={{ fontWeight: 'medium', mb: 2 }}>
            About this solution:
          </Typography>
          <Typography variant="body1" component="h3" paragraph>
            This application was created to tackle a significant challenge in the digital era:
            improving the accessibility of digital document collections.
          </Typography>
          <Typography variant="body1" component="h3" paragraph>
            To start using this app,{' '}
            <Box component="span" sx={{ color: '#FFC627', fontWeight: 'bold' }}>
              click the button to the right
            </Box>{' '}
            to upload your document, and receive your remediated PDF in return.
          </Typography>

          {/* Provided By Section */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              mt: 4,
            }}
          >
            <Typography variant="body1" component="h3" sx={{ mr: 1, fontWeight: 'bold' }}>
              Provided by Logrus Global
            </Typography>
          </Box>
        </Box>

        {/* Right Side: Gradient + Button + Link in the black area */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column', // Column so the link can appear below the gradient box
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative',
            minWidth: '300px',
          }}
        >
          {/* Gradient box with the button */}
          <GradientBox>
            <Typography
              variant="h5"
              component="h2"
              sx={{
                mb: 4,
                color: '#FFC627',
                textAlign: 'center',
                fontWeight: 'bold',
              }}
            >
              READY TO TRANSFORM YOUR PDF?
            </Typography>
            <LoadingButton
              variant="contained"
              size="large"
              endIcon={<ArrowForwardIosIcon />}
              onClick={handleSignIn}
              loading={loading}
              component="button"
              loadingIndicator={
                <CircularProgress
                  size={24}
                  sx={{ color: '#000' }}
                />
              }
              sx={{
                backgroundColor: '#FFC627',
                color: '#000',
                fontWeight: 'bold',
                fontSize: '1.2rem',
                width: 350,
                height: 50,
                overflow: 'hidden',
                position: 'relative',
                borderRadius: '25px',
                transition: 'transform 0.2s, background-color 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '&:hover': {
                  backgroundColor: '#e6ae22',
                  transform: 'scale(1.05)',
                },
                '&.MuiLoadingButton-loading': {
                  backgroundColor: '#FFC627',
                },
              }}
            >
              Login and Remediate My PDF
            </LoadingButton>
          </GradientBox>

          {/* Link placed outside the GradientBox but still in the black area */}
          <Box sx={{ mt: 2 }}>
            <StyledLink
              href="#"
              onClick={(e) => {
                e.preventDefault();
                handleOpenDialog();
              }}
              sx={{ fontSize: '0.9rem', color: '#FFC627' }}
            >
              Learn more about the remediation process
            </StyledLink>
          </Box>
        </Box>
      </Box>

      {/* 
        Dialog (modal) for remediation process
      */}
      <Dialog
  open={openDialog}
  onClose={handleCloseDialog}
  aria-labelledby="remediation-dialog-title"
>
  <DialogTitle
    id="remediation-dialog-title"
    sx={{ pr: 4, position: 'relative' }}
  >
    <strong>Remediation Process</strong>
    <IconButton
      aria-label="close"
      onClick={handleCloseDialog}
      sx={{
        position: 'absolute',
        right: 8,
        top: 8,
        color: (theme) => theme.palette.grey[500],
      }}
    >
      <CloseIcon />
    </IconButton>
  </DialogTitle>

  <DialogContent dividers>
    <Typography variant="body1" component="p"  paragraph>
      Here’s how our PDF Remediation process works:
    </Typography>

    <Typography variant="body2" component="p" paragraph>
      1. <strong>Upload a Document:</strong> Once you are logged in,
      simply select a PDF to upload for remediation.
    </Typography>
    <Typography variant="body2" component="p" paragraph>
      2. <strong>Remediation:</strong> We use an automated approach,
      supported by Adobe’s API and AWS services, to fix common accessibility
      issues like missing tags, incorrect reading order, Alt Text and more.
    </Typography>
    <Typography variant="body2" component="p" paragraph>
      3. <strong>Download Your Accessible PDF:</strong> Within a short
      time, you’ll receive your remediated PDF and accessiblity reports ready to share with
      everyone.
    </Typography>

    {/* Additional Restrictions Section */}
    <Typography variant="body1" component="p" paragraph sx={{ mt: 2 }}>
      <strong>Please note the following restrictions before uploading:</strong>
    </Typography>
    <Typography variant="body2" component="p" paragraph>
      1. Do not upload documents containing sensitive information.
    </Typography>
    <Typography variant="body2" component="p" paragraph>
      2. This solution only remediates PDF documents. Other document types will not be accepted.
    </Typography>
    <Typography variant="body2" component="p" paragraph>
      3. This solution does not remediate fillable forms or handle color selection/contrast.
    </Typography>
    <Typography variant="body1" component="p" paragraph>
      This solution is <em>open source</em> and can be deployed in your
      own AWS environment. Check out{' '}
      <StyledLink
                href="https://github.com/ASUCICREPO/PDF_Accessibility"
                target="_blank"
                rel="noopener"
                sx={{ ml: 0.5 }}
              >
                Github
      </StyledLink>
    </Typography>
  </DialogContent>
</Dialog>
    </Box>
  );
};

export default LandingPage;
