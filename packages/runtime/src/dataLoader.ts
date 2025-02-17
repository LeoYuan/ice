import type { DataLoaderConfig, DataLoaderResult, RuntimeModules, AppExport, StaticRuntimePlugin, CommonJsRuntime } from './types.js';
import getRequestContext from './requestContext.js';

interface Loaders {
  [routeId: string]: DataLoaderConfig;
}

interface CachedResult {
  value: any;
  status: string;
}

interface LoaderOptions {
  fetcher: Function;
  runtimeModules: RuntimeModules['statics'];
  appExport: AppExport;
}

export function defineDataLoader(dataLoaderConfig: DataLoaderConfig): DataLoaderConfig {
  return dataLoaderConfig;
}

export function defineServerDataLoader(dataLoaderConfig: DataLoaderConfig): DataLoaderConfig {
  return dataLoaderConfig;
}

export function defineStaticDataLoader(dataLoaderConfig: DataLoaderConfig): DataLoaderConfig {
  return dataLoaderConfig;
}

/**
 * Custom fetcher for load static data loader config.
 * Set globally to avoid passing this fetcher too deep.
 */
let dataLoaderFetcher;

export function setFetcher(customFetcher) {
  dataLoaderFetcher = customFetcher;
}

export function loadDataByCustomFetcher(config) {
  return dataLoaderFetcher(config);
}

/**
 * Handle for different dataLoader.
 */
export function callDataLoader(dataLoader: DataLoaderConfig, requestContext): DataLoaderResult {
  if (Array.isArray(dataLoader)) {
    const loaders = dataLoader.map(loader => {
      return typeof loader === 'object' ? loadDataByCustomFetcher(loader) : loader(requestContext);
    });
    return Promise.all(loaders);
  }

  if (typeof dataLoader === 'object') {
    return loadDataByCustomFetcher(dataLoader);
  }

  return dataLoader(requestContext);
}

const cache = new Map<string, CachedResult>();

/**
 * Start getData once data-loader.js is ready in client, and set to cache.
 */
function loadInitialDataInClient(loaders: Loaders) {
  const context = (window as any).__ICE_APP_CONTEXT__ || {};
  const matchedIds = context.matchedIds || [];
  const routesData = context.routesData || {};
  const { renderMode } = context;

  const ids = ['_app'].concat(matchedIds);
  ids.forEach(id => {
    const dataFromSSR = routesData[id];
    if (dataFromSSR) {
      cache.set(renderMode === 'SSG' ? `${id}_ssg` : id, {
        value: dataFromSSR,
        status: 'RESOLVED',
      });

      if (renderMode === 'SSR') {
        return;
      }
    }

    const dataLoader = loaders[id];

    if (dataLoader) {
      const requestContext = getRequestContext(window.location);
      const loader = callDataLoader(dataLoader, requestContext);

      cache.set(id, {
        value: loader,
        status: 'LOADING',
      });
    }
  });
}

/**
 * Init data loader in client side.
 * Load initial data and register global loader.
 * In order to load data, JavaScript modules, CSS and other assets in parallel.
 */
async function init(dataloaderConfig: Loaders, options: LoaderOptions) {
  const {
    fetcher,
    runtimeModules,
    appExport,
  } = options;

  const runtimeApi = {
    appContext: {
      appExport,
    },
  };

  if (runtimeModules) {
    await Promise.all(runtimeModules.map(module => {
      const runtimeModule = ((module as CommonJsRuntime).default || module) as StaticRuntimePlugin;
      return runtimeModule(runtimeApi);
    }).filter(Boolean));
  }

  if (fetcher) {
    setFetcher(fetcher);
  }

  try {
    loadInitialDataInClient(dataloaderConfig);
  } catch (error) {
    console.error('Load initial data error: ', error);
  }

  (window as any).__ICE_DATA_LOADER__ = {
    getData: async (id, options) => {
      let result;

      // first render for ssg use data from build time.
      // second render for ssg will use data from data loader.
      if (options?.ssg) {
        result = cache.get(`${id}_ssg`);
      } else {
        result = cache.get(id);
      }

      // Already send data request.
      if (result) {
        const { status, value } = result;

        if (status === 'RESOLVED') {
          return result;
        }

        if (Array.isArray(value)) {
          return await Promise.all(value);
        }

        return await value;
      }

      const dataLoader = dataloaderConfig[id];

      // No data loader.
      if (!dataLoader) {
        return null;
      }

      // Call dataLoader.
      // In CSR, all dataLoader is called by global data loader to avoid bundle dataLoader in page bundle duplicate.
      const requestContext = getRequestContext(window.location);
      return await callDataLoader(dataLoader, requestContext);
    },
  };
}

export default {
  init,
};