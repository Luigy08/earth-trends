import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: { main: '#204c3e', dark: '#16392f', contrastText: '#fffdf7' },
    secondary: { main: '#d96c3f' },
    background: { default: '#f6f5ef', paper: '#fffef9' },
    text: { primary: '#243c33', secondary: '#788078' },
    divider: '#e3e5db',
    warning: { main: '#9c662c' },
  },
  typography: {
    fontFamily: '"Manrope", sans-serif', fontSize: 13,
    h1: { fontFamily: '"Instrument Serif", serif', fontWeight: 400 },
    h2: { fontFamily: '"Instrument Serif", serif', fontWeight: 400 },
    h3: { fontFamily: '"Instrument Serif", serif', fontWeight: 400 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 7, padding: '10px 18px' } } },
    MuiOutlinedInput: { styleOverrides: { root: { background: '#fffef9', fontSize: 13 }, notchedOutline: { borderColor: '#dfe2d7' } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 700, minHeight: 47, fontSize: 12 } } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16, backgroundImage: 'none' } } },
  },
});
