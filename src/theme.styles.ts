import { createTheme } from '@mui/material/styles';
import { COLORS, FONTS } from './theme.constant';

const toVariables = (prefix: string, tokens: Record<string, string>) => Object.fromEntries(
  Object.entries(tokens).map(([name, value]) => [`--${prefix}-${name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()}`, value]),
);

export const themeVariables = { ...toVariables('color', COLORS), ...toVariables('font', FONTS) };

export const theme = createTheme({
  palette: {
    primary: { main: COLORS.green800, dark: COLORS.green900, contrastText: COLORS.paper },
    secondary: { main: COLORS.accent },
    background: { default: COLORS.page, paper: COLORS.paper },
    text: { primary: COLORS.ink, secondary: COLORS.sage600 },
    divider: COLORS.line100,
    warning: { main: COLORS.warning },
  },
  typography: {
    fontFamily: FONTS.body, fontSize: 13,
    h1: { fontFamily: FONTS.display, fontWeight: 400 },
    h2: { fontFamily: FONTS.display, fontWeight: 400 },
    h3: { fontFamily: FONTS.display, fontWeight: 400 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCssBaseline: { styleOverrides: { ':root': themeVariables } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 7, padding: '10px 18px' } } },
    MuiOutlinedInput: { styleOverrides: { root: { background: COLORS.paper, fontSize: 13 }, notchedOutline: { borderColor: COLORS.line100 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 700, minHeight: 47, fontSize: 12 } } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16, backgroundImage: 'none' } } },
  },
});
