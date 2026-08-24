import type {
  history as generatedHistory,
  useLocation as generatedUseLocation,
  useModel as generatedUseModel,
  useRequest as generatedUseRequest,
} from '../src/.umi/exports';

declare module '@umijs/max' {
  export const history: typeof generatedHistory;
  export const useLocation: typeof generatedUseLocation;
  export const useModel: typeof generatedUseModel;
  export const useRequest: typeof generatedUseRequest;
}
