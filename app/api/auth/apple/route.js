import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// 环境变量
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || 'xsd1dfd8caa-d7fc-4c7d-b4a1-5bf3c21bf168';
const JWT_SECRET = process.env.JWT_SECRET || 'o9Kqhg4uCVQufgrXRS8bSEXMzjVOx5Wp/upX6PZlxbA=';
const APPLE_PUBLIC_KEYS_URL = process.env.APPLE_PUBLIC_KEYS_URL || 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = process.env.APPLE_ISSUER || 'https://appleid.apple.com';
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.mirror.BabyPic';

// 统一响应处理
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

/** 将 JWK 格式的公钥转换为 PEM 格式 */
const jwkToPem = (jwk) => {
  const { n, e, kty } = jwk;
  if (kty !== 'RSA') throw new Error('不支持的非 RSA 密钥类型: ' + kty);
  
  const keyObject = crypto.createPublicKey({
    key: { kty: 'RSA', n, e },
    format: 'jwk',
  });
  return keyObject.export({ type: 'spki', format: 'pem' });
};

/** 验证苹果 identityToken */
const verifyAppleIdentityToken = async (identityToken) => {
  try {
    if (!identityToken) return { valid: false, error: 'identityToken 不能为空' };
    
    const decoded = jwt.decode(identityToken, { complete: true });
    if (!decoded || !decoded.header) return { valid: false, error: 'Token 格式无效' };
    
    const { kid, alg } = decoded.header;
    const keysResponse = await fetch(APPLE_PUBLIC_KEYS_URL);
    if (!keysResponse.ok) return { valid: false, error: '获取苹果公钥失败' };
    
    const keysData = await keysResponse.json();
    const publicKeyJwk = keysData.keys.find(k => k.kid === kid);
    if (!publicKeyJwk) return { valid: false, error: '找不到对应的公钥' };
    
    const publicKeyPem = jwkToPem(publicKeyJwk);
    const verifyOptions = {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      clockTolerance: 30,
      complete: false,
    };
    
    if (APPLE_BUNDLE_ID) verifyOptions.audience = APPLE_BUNDLE_ID;
    
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
    if (error.name === 'TokenExpiredError') return { valid: false, error: 'Token 已过期' };
    if (error.name === 'JsonWebTokenError') {
      let detail = error.message;
      if (error.message.includes('audience')) detail += ` (期望: ${APPLE_BUNDLE_ID || '未设置'})`;
      return { valid: false, error: `Token 无效或签名验证失败: ${detail}` };
    }
    return { valid: false, error: error.message };
  }
};

/** 生成用户 session token */
const generateSessionToken = (userData) => {
  if (!JWT_SECRET) throw new Error('JWT_SECRET 未配置');
  return jwt.sign(
    { userId: userData.sub, email: userData.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

// 处理 POST 请求
export async function POST(request) {
  try {
    // 鉴权验证
    const clientToken = request.headers.get('x-auth-token') || request.headers.get('X-Auth-Token');
    if (!API_AUTH_TOKEN || clientToken !== API_AUTH_TOKEN) {
      return createResponse(401, { code: 401, message: '鉴权失败' });
    }
    console.log('Received POST /auth/apple');

    // 解析请求体
    const body = await request.json().catch(() => ({}));
    const { userIdentifier, identityToken } = body;
    console.log('Received POST /auth/apple with body:', body);

    if (!identityToken) {
      return createResponse(400, { code: 400, message: 'identityToken 不能为空' });
    }

    // 验证苹果 Token
    const result = await verifyAppleIdentityToken(identityToken);
    if (!result.valid) {
      return createResponse(400, {
        code: 400,
        message: '苹果登录验证失败',
        error: result.error,
      });
    }

    // 验证用户标识
    if (userIdentifier && userIdentifier !== result.data.sub) {
      return createResponse(400, { code: 400, message: '用户标识不匹配' });
    }

    // 生成 session token
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
}

// 处理 OPTIONS 预检请求
export async function OPTIONS() {
  return createResponse(200, { message: 'OK' });
}