import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

// App Store Connect API 配置
const APPLE_STORE_KIT_BASE_URL = 'https://api.storekit.itunes.apple.com';
const APPLE_STORE_KIT_SANDBOX_URL = 'https://api.storekit-sandbox.itunes.apple.com';

const KEY_ID = process.env.APPLE_KEY_ID || '58SQU6AZ3P';
const ISSUER_ID = process.env.APPLE_ISSUER_ID || 'bf8d4031-ee94-4f62-9c2f-963cb0293ed2';
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.mirror.BabyPic';
const PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY || `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgqXDyiQDgPUyARb2x
03XSifWHMHN8Vs9+m1mOCFZrd/6gCgYIKoZIzj0DAQehRANCAARVj3yOE+uGpYQo
Vj7SLR5tjITz0odK1NeSk/0K+rupX8LyP8wCX//vEqVY77YGdS1vVwCS4nv/NPRF
5T1e+pli
-----END PRIVATE KEY-----`;

/**
 * 生成 App Store Server API JWT
 */
function generateAppStoreJWT() {
  if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID || !PRIVATE_KEY) {
    throw new Error('缺少 App Store Connect API 配置: KEY_ID, ISSUER_ID, BUNDLE_ID, PRIVATE_KEY');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER_ID,
    iat: now,
    exp: now + 3600, // 1小时过期
    aud: 'appstoreconnect-v1',
    bid: BUNDLE_ID
  };

  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: 'ES256',
    header: {
      alg: 'ES256',
      kid: KEY_ID,
      typ: 'JWT'
    }
  });
}

/**
 * 获取 App Store API 认证头
 */
function getAppStoreHeaders() {
  const token = generateAppStoreJWT();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

/**
 * 新版 API: 通过 transactionId 查询交易状态（自动识别环境）
 * 先尝试沙盒，失败时自动切换生产
 * @param {string} transactionId - 交易ID
 * @returns {{ signedTransactionInfo: string, environment: 'Sandbox' | 'Production' }}
 */
async function getTransaction(transactionId) {
  // 先尝试沙盒环境
  try {
    const result = await fetchTransaction(transactionId, true);
    return { ...result, environment: 'Sandbox' };
  } catch (error) {
    console.log('查询交易失败:', error);
    // 210050001 表示环境不匹配，尝试生产环境
    if (error.message.includes('210050001')) {
      console.log('沙盒环境查不到，尝试生产环境');
      const result = await fetchTransaction(transactionId, false);
      console.log('生产环境查询成功:', result);
      return { ...result, environment: 'Production' };
    }
    throw error;
  }
}

/**
 * 实际执行 API 请求
 * @param {string} transactionId - 交易ID
 * @param {boolean} isSandbox - 是否沙盒环境
 */
async function fetchTransaction(transactionId, isSandbox) {
  const baseUrl = isSandbox ? APPLE_STORE_KIT_SANDBOX_URL : APPLE_STORE_KIT_BASE_URL;
  const url = `${baseUrl}/inApps/v1/transactions/${transactionId}`;
  console.log('查询 URL:', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: getAppStoreHeaders()
  });

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorCode = responseData.errorCode || response.status;
    const errorMessage = responseData.errorMessage || response.statusText;
    throw new Error(`查询交易失败: ${errorCode} - ${errorMessage}`);
  }

  return responseData;
}

/**
 * 新版 API: 发送消耗确认（通知苹果该交易已处理）
 * @param {string} transactionId - 交易ID
 * @param {boolean} isSandbox - 是否沙盒环境
 */
async function consumeTransaction(transactionId, isSandbox = false) {
  const baseUrl = isSandbox ? APPLE_STORE_KIT_SANDBOX_URL : APPLE_STORE_KIT_BASE_URL;
  const url = `${baseUrl}/inApps/v1/transactions/consume/${transactionId}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: getAppStoreHeaders()
  });

  // 404 表示交易已被消耗或不存在，可以视为成功
  return response.status === 200 || response.status === 404;
}

/**
 * 新版 API: 获取订阅状态历史
 * @param {string} originalTransactionId - 原始交易ID
 * @param {boolean} isSandbox - 是否沙盒环境
 */
async function getSubscriptionStatus(originalTransactionId, isSandbox = false) {
  const baseUrl = isSandbox ? APPLE_STORE_KIT_SANDBOX_URL : APPLE_STORE_KIT_BASE_URL;
  const url = `${baseUrl}/inApps/v1/subscriptions/${originalTransactionId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: getAppStoreHeaders()
  });

  if (!response.ok) {
    const responseData = await response.json().catch(() => ({}));
    throw new Error(`查询订阅状态失败: ${response.status} - ${JSON.stringify(responseData)}`);
  }

  return await response.json();
}

/**
 * 解析 signedTransactionInfo
 * @param {string} signedPayload - JWT 格式的交易信息
 */
function parseTransactionInfo(signedPayload) {
  try {
    const decoded = jwt.decode(signedPayload, { complete: true });
    return {
      ...decoded.payload,
      raw: signedPayload
    };
  } catch (error) {
    console.error('解析交易信息失败:', error);
    return null;
  }
}

/**
 * POST - 苹果支付校验（使用新版 App Store Server API）
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { transactionId, productId } = body;

    console.log('POST /api/pay/verify', { transactionId, productId });

    // 参数校验
    if (!transactionId) {
      return NextResponse.json(
        { success: false, message: '缺少交易ID(transactionId)' },
        { status: 400 }
      );
    }

    // 查询交易（自动识别环境）
    const transactionData = await getTransaction(transactionId);
    const environment = transactionData.environment;
    console.log('识别到环境:', environment);

    // 检查交易状态
    const signedTransactionInfo = transactionData.signedTransactionInfo;
    const transactionInfo = parseTransactionInfo(signedTransactionInfo);
    console.log('transactionInfo:', transactionInfo);

    if (!transactionInfo) {
      return NextResponse.json(
        { success: false, message: '解析交易信息失败' },
        { status: 500 }
      );
    }

    // 检查交易类型和状态
    if (transactionInfo.type === 'Non-Consumable' || transactionInfo.type === 'Consumable') {
      // 非消耗型和消耗型商品：检查 inAppOwnershipType
      if (transactionInfo.inAppOwnershipType !== 'PURCHASED') {
        return NextResponse.json(
          { success: false, message: '交易所有权类型不正确', inAppOwnershipType: transactionInfo.inAppOwnershipType },
          { status: 400 }
        );
      }

      // 验证商品ID
      if (productId && productId !== transactionInfo.productId) {
        return NextResponse.json(
          { success: false, message: '商品ID不匹配', expected: productId, actual: transactionInfo.productId },
          { status: 400 }
        );
      }

      // 消耗型商品：发送消耗确认
      if (transactionInfo.type === 'Consumable') {
        try {
          await consumeTransaction(transactionId, environment === 'Sandbox');
          console.log('交易已标记为已消耗:', transactionId);
        } catch (error) {
          console.error('消耗交易失败:', error);
          // 消耗失败不影响验证结果，仅记录日志
        }
      }
    } else if (transactionInfo.type === 'Auto-Renewable Subscription') {
      // 自动续期订阅：获取订阅状态
      try {
        const statusData = await getSubscriptionStatus(transactionInfo.originalTransactionId, environment === 'Sandbox');
        const lastStatus = statusData.data?.lastTransactions?.[0];

        if (lastStatus) {
          const signedInfo = parseTransactionInfo(lastStatus.signedRenewalInfo || lastStatus.signedTransactionInfo);
          if (signedInfo) {
            transactionInfo.subscriptionStatus = signedInfo;
          }
        }
      } catch (error) {
        console.error('获取订阅状态失败:', error);
        // 订阅状态查询失败不影响主流程
      }
    }

    // 格式化日期
    if (transactionInfo.purchaseDate) {
      transactionInfo.purchaseDate = new Date(parseInt(transactionInfo.purchaseDate) / 1000).toISOString();
    }
    if (transactionInfo.expiresDate) {
      transactionInfo.expiresDate = new Date(parseInt(transactionInfo.expiresDate) / 1000).toISOString();
    }
    if (transactionInfo.revocationDate) {
      transactionInfo.revocationDate = new Date(parseInt(transactionInfo.revocationDate) / 1000).toISOString();
    }

    // 构建订单信息
    const orderInfo = {
      orderId: `ORDER_${Date.now()}`,
      transactionId: transactionInfo.transactionId,
      originalTransactionId: transactionInfo.originalTransactionId,
      productId: transactionInfo.productId,
      quantity: transactionInfo.quantity || 1,
      purchaseDate: transactionInfo.purchaseDate,
      expiresDate: transactionInfo.expiresDate || null,
      environment,
      type: transactionInfo.type || 'unknown'
    };

    // 返回成功响应
    return NextResponse.json({
      success: true,
      message: '支付验证成功',
      data: {
        orderInfo,
        transactionInfo: {
          transactionId: transactionInfo.transactionId,
          originalTransactionId: transactionInfo.originalTransactionId,
          productId: transactionInfo.productId,
          quantity: transactionInfo.quantity || 1,
          purchaseDate: transactionInfo.purchaseDate,
          expiresDate: transactionInfo.expiresDate,
          isTrialPeriod: transactionInfo.isTrialPeriod,
          isInIntroOfferPeriod: transactionInfo.isInIntroOfferPeriod,
          type: transactionInfo.type,
          inAppOwnershipType: transactionInfo.inAppOwnershipType
        }
      }
    });

  } catch (error) {
    console.error('苹果支付验证错误:', error);
    return NextResponse.json(
      { success: false, message: '服务器内部错误', error: error.message },
      { status: 500 }
    );
  }
}
