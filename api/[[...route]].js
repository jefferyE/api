import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import OpenAI from 'openai';

// 环境变量（在 Vercel Dashboard 中配置）
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || '';
const SEEDREAM_API_BASE_URL = process.env.SEEDREAM_API_BASE_URL || '';
const SEEDREAM_API_KEY = process.env.SEEDREAM_API_KEY || '';

// 苹果验证配置
const JWT_SECRET = process.env.JWT_SECRET || '';
const APPLE_PUBLIC_KEYS_URL = process.env.APPLE_PUBLIC_KEYS_URL || '';
const APPLE_ISSUER = process.env.APPLE_ISSUER || '';
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || '';

// OpenAI 实例
const client = new OpenAI({
  baseURL: SEEDREAM_API_BASE_URL,
  apiKey: SEEDREAM_API_KEY,
});

/** 将 JWK 格式的公钥转换为 PEM 格式 */
const jwkToPem = (jwk) => {
  const { n, e, kty } = jwk;

  if (kty !== 'RSA') {
    throw new Error('不支持的非 RSA 密钥类型: ' + kty);
  }

  // 使用 Web Crypto API 兼容的方式创建公钥
  const keyObject = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: n,
      e: e,
    },
    format: 'jwk',
  });

  return keyObject.export({ type: 'spki', format: 'pem' });
};

/** 验证苹果 identityToken */
const verifyAppleIdentityToken = async (identityToken) => {
  try {
    if (!identityToken) {
      return { valid: false, error: 'identityToken 不能为空' };
    }

    const decoded = jwt.decode(identityToken, { complete: true });
    if (!decoded || !decoded.header) {
      return { valid: false, error: 'Token 格式无效' };
    }

    const { kid, alg } = decoded.header;

    console.log('Token header:', { kid, alg });
    console.log('Token payload (未验证):', decoded.payload);

    const keysResponse = await fetch(APPLE_PUBLIC_KEYS_URL);
    if (!keysResponse.ok) {
      return { valid: false, error: '获取苹果公钥失败' };
    }
    const keysData = await keysResponse.json();
    const publicKeyJwk = keysData.keys.find(k => k.kid === kid);

    if (!publicKeyJwk) {
      console.log('可用公钥 kids:', keysData.keys.map(k => k.kid));
      return { valid: false, error: '找不到对应的公钥' };
    }

    const publicKeyPem = jwkToPem(publicKeyJwk);

    const verifyOptions = {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      clockTolerance: 30,
      complete: false,
    };

    if (APPLE_BUNDLE_ID) {
      verifyOptions.audience = APPLE_BUNDLE_ID;
      console.log('验证 audience:', APPLE_BUNDLE_ID);
    } else {
      console.log('警告: APPLE_BUNDLE_ID 未设置，跳过 audience 验证');
    }

    console.log('验证选项:', verifyOptions);
    const payload = jwt.verify(identityToken, publicKeyPem, verifyOptions);

    return {
      valid: true,
      data: {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified,
        iss: payload.iss,
        aud: payload.aud,
        exp: payload.exp,
        iat: payload.iat,
      }
    };

  } catch (error) {
    console.error('苹果登录验证错误:', error.name, error.message);
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token 已过期' };
    }
    if (error.name === 'JsonWebTokenError') {
      let detail = error.message;
      if (error.message.includes('audience')) {
        detail += ` (期望: ${APPLE_BUNDLE_ID || '未设置'})`;
      }
      return { valid: false, error: `Token 无效或签名验证失败: ${detail}` };
    }
    return { valid: false, error: error.message };
  }
};

/** 生成用户 session token */
const generateSessionToken = (userData) => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET 未配置，请设置环境变量');
  }
  return jwt.sign(
    {
      userId: userData.sub,
      email: userData.email,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

/** 统一响应处理函数 */
const createResponse = (statusCode, data) => {
  return NextResponse.json(data, {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
    },
  });
};

/** 处理苹果登录 */
const handleAppleAuth = async (body) => {
  try {
    const { userIdentifier, identityToken } = body;

    if (!identityToken) {
      return createResponse(400, {
        code: 400,
        message: 'identityToken 不能为空',
      });
    }

    const result = await verifyAppleIdentityToken(identityToken);

    if (!result.valid) {
      return createResponse(400, {
        code: 400,
        message: '苹果登录验证失败',
        error: result.error,
      });
    }

    if (userIdentifier && userIdentifier !== result.data.sub) {
      return createResponse(400, {
        code: 400,
        message: '用户标识不匹配',
      });
    }

    const sessionToken = generateSessionToken(result.data);

    return createResponse(200, {
      code: 200,
      message: '登录成功',
      token: sessionToken,
      userId: result.data.sub,
      email: result.data.email,
    });
  } catch (error) {
    console.error('苹果登录处理错误:', error);
    return createResponse(500, {
      code: 500,
      message: error.message || '服务器错误',
    });
  }
};

/** 处理图片生成 */
const handleGenerateImage = async (body) => {
  const { prompt = '', size = '2K', image = [] } = body;

  if (!prompt) {
    return createResponse(400, { code: 400, error: 'prompt 不能为空' });
  }

  try {
    const response = await client.images.generate({
      model: 'doubao-seedream-4-5-251128',
      prompt: prompt,
      image: image,
      watermark: false,
      size: size,
      response_format: 'b64_json',
      sequential_image_generation: 'disabled',
    });

    return createResponse(200, {
      code: 200,
      data: response.data[0]?.b64_json,
      message: '调用成功',
    });
  } catch (error) {
    console.error('图片生成错误:', error);
    return createResponse(500, {
      code: 500,
      message: error.message || '图片生成失败',
      error: error.toString(),
    });
  }
};

// 主处理函数
export async function POST(request) {
  try {
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return createResponse(200, { message: 'OK' });
    }

    // 1. 鉴权验证
    const clientToken = request.headers.get('x-auth-token') || request.headers.get('X-Auth-Token');
    if (!API_AUTH_TOKEN || clientToken !== API_AUTH_TOKEN) {
      return createResponse(401, { code: 401, message: '鉴权失败' });
    }

    // 2. 解析请求体
    const body = await request.json().catch(() => ({}));

    // 3. 获取请求路径
    const path = new URL(request.url).pathname;

    // 4. 路由分发
    if (path === '/api/generate') {
      return handleGenerateImage(body);
    }

    if (path === '/api/auth/apple') {
      return handleAppleAuth(body);
    }

    // 404 路由
    return createResponse(404, {
      code: 404,
      message: '路由不存在',
    });

  } catch (error) {
    console.error('主处理函数错误:', error);
    return createResponse(500, {
      code: 500,
      message: error.message || '服务器错误',
    });
  }
}

// 处理 OPTIONS 预检请求
export async function OPTIONS() {
  return createResponse(200, { message: 'OK' });
}