// src/components/Header.js
import React from 'react';
import {
  AppBar,
  Toolbar,
  Button,
  Box,
  IconButton,
  useMediaQuery,
  useTheme
} from '@mui/material';
import PropTypes from 'prop-types';
import { HEADER_BACKGROUND } from '../utilities/constants';
import logo from '../assets/pdf-accessability-logo.svg';
import MenuIcon from '@mui/icons-material/Menu';

function Header({ handleSignOut, onMenuClick }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <AppBar position="static" color={HEADER_BACKGROUND} role="banner" aria-label="Application Header">
      <Toolbar sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexWrap: 'nowrap',
        minHeight: { xs: 56, sm: 64 },
        overflow: 'hidden'
      }}>
        
        {/* Left Side: Menu Button (mobile) + App Title with Logo */}
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: { xs: 1, sm: 2 },
          flex: '0 0 auto',
          minWidth: 0
        }}>
          {isMobile && onMenuClick && (
            <IconButton
              color="inherit"
              aria-label="open navigation menu"
              onClick={onMenuClick}
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <img
              src={logo}
              alt="PDF Accessibility Logo"
              style={{ 
                height: isMobile ? '32px' : '40px', 
                width: 'auto' 
              }}
            />
          </Box>
        </Box>

        {/* Right Side: Home Button */}
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 0.5, sm: 2 },
          flexWrap: 'nowrap',
          minWidth: 0, // Allow shrinking
          flex: '0 0 auto' // Don't grow or shrink
        }}>

          {/* Home Button */}
          <Button
            onClick={handleSignOut}
            variant="outlined"
            size={isMobile ? 'small' : 'medium'}
            sx={{
              borderColor: '#1976d2',
              color: '#1976d2',
              padding: isMobile ? '2px 6px' : '6px 16px',
              borderRadius: '4px',
              fontSize: isMobile ? '0.6rem' : '0.875rem',
              minHeight: isMobile ? 32 : 40,
              maxHeight: isMobile ? 32 : 40,
              minWidth: isMobile ? 45 : 'auto',
              maxWidth: isMobile ? 45 : 'auto',
              height: isMobile ? 32 : 40,
              flex: '0 0 auto',
              whiteSpace: 'nowrap',
              transform: 'scale(1)',
              zoom: 1,
              '&:hover': {
                backgroundColor: 'rgba(25, 118, 210, 0.1)',
                borderColor: '#1565c0',
                transform: 'scale(1)',
              },
              '&:focus': {
                outline: 'none',
                boxShadow: '0 0 4px rgba(25, 118, 210, 0.5)',
                transform: 'scale(1)',
              },
              transition: 'all 0.3s ease-in-out',
            }}
            aria-label="Home Button"
          >
            {isMobile ? 'Home' : 'Home'}
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}

Header.propTypes = {
  handleSignOut: PropTypes.func.isRequired,
  onMenuClick: PropTypes.func,
};

export default Header;
