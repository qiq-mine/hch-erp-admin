import { createStyles } from 'antd-style';

export const useDashboardStyles = createStyles(({ css, token }) => ({
  sectionGap: css`
    margin-top: ${token.marginLG}px;
  `,
  responsiveSplit: css`
    min-width: 0;
    max-width: 100%;

    @media (max-width: 1200px) {
      > .ant-pro-card-body {
        flex-direction: column;
      }

      > .ant-pro-card-body > .ant-pro-card-col {
        width: 100%;
        max-width: 100%;
      }
    }
  `,
  recordMeta: css`
    display: flex;
    align-items: center;
    gap: ${token.marginXS}px;
    flex-wrap: wrap;
  `,
  recordTimeline: css`
    margin-top: ${token.marginSM}px;
    padding-left: ${token.paddingXS}px;
  `,
  processFlow: css`
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    padding: ${token.paddingMD}px ${token.paddingXS}px ${token.paddingXS}px;

    .ant-steps {
      min-width: 720px;
    }
  `,
  deltaPositive: css`
    color: ${token.colorSuccess};
  `,
  deltaNegative: css`
    color: ${token.colorError};
  `,
}));
