import { defineConfig } from '@umijs/max';
import { PRODUCT_NAME } from '../src/config/product';
import routes from './routes';

export default defineConfig({
  antd: {},
  access: {},
  esbuildMinifyIIFE: true,
  initialState: {},
  model: {},
  request: {},
  layout: {
    title: PRODUCT_NAME,
  },
  locale: {
    default: 'zh-CN',
    antd: true,
    baseNavigator: false,
  },
  routes,
  title: PRODUCT_NAME,
});
