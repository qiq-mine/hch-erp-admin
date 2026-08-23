import { createStyles } from 'antd-style';

export const useRecordsStyles = createStyles(({ css, token }) => ({
  tableViewport: css`
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
  `,
  loadState: css`
    margin-bottom: ${token.marginSM}px;
  `,
  clickableRow: css`
    cursor: pointer;
  `,
  errorPanel: css`
    margin-bottom: ${token.marginMD}px;
  `,
  hiddenTable: css`
    display: none;
  `,
}));
