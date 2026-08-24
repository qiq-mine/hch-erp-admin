import { createStyles } from 'antd-style';

export const useRecordsStyles = createStyles(({ css, token }) => ({
  tableViewport: css`
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;

    .ant-pro-query-filter .ant-form-item-label {
      flex: none;
      white-space: nowrap;
    }

    .ant-pro-query-filter .ant-form-item-control,
    .ant-pro-query-filter .ant-form-item-control-input,
    .ant-pro-query-filter .ant-form-item-control-input-content {
      min-width: 0;
    }
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
