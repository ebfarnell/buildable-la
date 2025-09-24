import fetch from 'node-fetch';

const DEFAULT_TIMEOUT = 5000;

async function fetchWithTimeout(url: string, options: any = {}, timeout = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response as Response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

export async function probeFeatureServer(url: string): Promise<boolean> {
  try {
    const queryUrl = `${url}?f=json&where=1=1&returnCountOnly=true&resultRecordCount=1`;
    const response = await fetchWithTimeout(queryUrl);

    if (response.status !== 200) {
      return false;
    }

    const data = await response.json() as any;
    return typeof data.count === 'number' && data.count >= 0;
  } catch (error) {
    return false;
  }
}

export async function probeMapServer(url: string): Promise<boolean> {
  try {
    const queryUrl = `${url}?f=json`;
    const response = await fetchWithTimeout(queryUrl);

    if (response.status !== 200) {
      return false;
    }

    const data = await response.json() as any;
    return !!(data.layers || data.capabilities || data.mapName);
  } catch (error) {
    return false;
  }
}

export async function probeVectorTile(
  template: string,
  zxy: { z: number; x: number; y: number } = { z: 10, x: 183, y: 410 }
): Promise<boolean> {
  try {
    const url = template
      .replace('{z}', zxy.z.toString())
      .replace('{x}', zxy.x.toString())
      .replace('{y}', zxy.y.toString());

    const response = await fetchWithTimeout(url);

    if (response.status !== 200) {
      return false;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 100) {
      return true;
    }

    const buffer = await response.buffer();
    return buffer.length > 100;
  } catch (error) {
    return false;
  }
}

export async function probeSTAC(collectionUrl: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(collectionUrl);

    if (response.status !== 200) {
      return false;
    }

    const data = await response.json() as any;
    return !!(data.id && data.extent);
  } catch (error) {
    return false;
  }
}

export async function probeFlatGeobuf(url: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Range: 'bytes=0-63',
      },
    });

    if (response.status !== 200 && response.status !== 206) {
      return false;
    }

    const buffer = await response.buffer();
    if (buffer.length >= 4) {
      const magic = buffer.toString('ascii', 0, 3);
      return magic === 'fgb';
    }

    return false;
  } catch (error) {
    return false;
  }
}