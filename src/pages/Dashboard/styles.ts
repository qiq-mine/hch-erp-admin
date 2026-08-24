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
    padding: ${token.paddingMD}px ${token.paddingSM}px;
  `,
  processCanvas: css`
    min-width: 660px;
  `,
  processRow: css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: ${token.marginLG + 20}px;
  `,
  processSegment: css`
    position: relative;
    min-width: 0;
  `,
  processNode: css`
    display: flex;
    align-items: center;
    gap: ${token.marginSM}px;
    min-height: 64px;
    padding: ${token.paddingSM}px ${token.paddingMD}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillAlter};
    box-shadow: ${token.boxShadowTertiary};
  `,
  processNodeCompleted: css`
    border-color: ${token.colorSuccessBorder};
    background: ${token.colorSuccessBg};
  `,
  processNodeActive: css`
    border-color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
    box-shadow: 0 0 0 2px ${token.colorPrimaryBorder};
  `,
  processNodeIndex: css`
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: ${token.colorTextSecondary};
    background: ${token.colorBgContainer};
  `,
  processNodeTitle: css`
    line-height: 1.4;
  `,
  processArrow: css`
    position: absolute;
    top: 50%;
    right: -34px;
    transform: translateY(-50%);
    color: ${token.colorPrimary};
    font-size: 18px;
  `,
  processTurn: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 54px;
    width: 25%;
    margin-left: auto;
    color: ${token.colorPrimary};
    font-size: 18px;

    span {
      width: 2px;
      height: 24px;
      background: ${token.colorPrimaryBorder};
    }
  `,
  deltaPositive: css`
    color: ${token.colorSuccess};
  `,
  deltaNegative: css`
    color: ${token.colorError};
  `,
}));
