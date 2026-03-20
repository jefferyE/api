import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

// 苹果验证服务器地址
const APPLE_VERIFY_URL = {
  production: 'https://buy.itunes.apple.com/verifyReceipt',
  sandbox: 'https://sandbox.itunes.apple.com/verifyReceipt'
};

/**
 * 验证苹果支付凭证
 * @param {string} receipt - Base64编码的支付凭证
 * @param {string} password - App共享密钥（可选，用于自动续期订阅）
 * @param {boolean} isSandbox - 是否沙盒环境
 */
async function verifyReceipt(receipt, password = '', isSandbox = false) {
  const url = isSandbox ? APPLE_VERIFY_URL.sandbox : APPLE_VERIFY_URL.production;

  const payload = {
    'receipt-data': receipt,
    ...(password && { password })
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`苹果服务器请求失败: ${response.status}`);
  }

  return await response.json();
}

/**
 * 解析验证结果
 * @param {object} verifyResult - 苹果返回的验证结果
 */
function parseVerifyResult(verifyResult) {
  const status = verifyResult.status;
  
  // 状态码说明
  const statusMessages = {
    0: '验证成功',
    21000: 'App Store无法读取你提供的JSON数据',
    21002: 'receipt-data属性中的数据格式错误或丢失',
    21003: '无法认证该receipt',
    21004: '你提供的共享密钥与账户的文件记录不匹配',
    21005: '收据服务器当前不可用',
    21006: '该收据有效，但订阅已过期。当交易被更新时，这将作为一个状态更新发送给你的服务器',
    21007: '该收据来自沙盒环境，但被发送到生产环境进行验证',
    21008: '该收据来自生产环境，但被发送到沙盒环境进行验证',
    21010: '该收据无法通过授权',
    21100: '内部数据访问错误'
  };

  return {
    isValid: status === 0,
    status,
    message: statusMessages[status] || '未知错误',
    environment: verifyResult.environment || 'production',
    receipt: verifyResult.receipt,
    latestReceipt: verifyResult.latest_receipt_info,
    pendingRenewalInfo: verifyResult.pending_renewal_info
  };
}

/**
 * POST - 苹果支付校验
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { 
      receipt, 
      password, 
      isSandbox = false,
      transactionId,
      productId,
      userId
    } = body;

    // 参数校验
    if (!receipt) {
      return NextResponse.json(
        { success: false, message: '缺少支付凭证(receipt)' },
        { status: 400 }
      );
    }

    if (!transactionId) {
      return NextResponse.json(
        { success: false, message: '缺少交易ID(transactionId)' },
        { status: 400 }
      );
    }

    // 调用苹果验证服务器
    let verifyResult;
    try {
      verifyResult = await verifyReceipt(receipt, password, isSandbox);
    } catch (error) {
      return NextResponse.json(
        { success: false, message: '苹果服务器验证失败', error: error.message },
        { status: 502 }
      );
    }

    // 解析验证结果
    const result = parseVerifyResult(verifyResult);

    // 如果状态码为21007，说明是沙盒环境receipt，自动切换到沙盒重试
    if (result.status === 21007 && !isSandbox) {
      try {
        verifyResult = await verifyReceipt(receipt, password, true);
        Object.assign(result, parseVerifyResult(verifyResult));
      } catch (error) {
        return NextResponse.json(
          { success: false, message: '沙盒环境验证失败', error: error.message },
          { status: 502 }
        );
      }
    }

    // 验证失败
    if (!result.isValid) {
      return NextResponse.json(
        { 
          success: false, 
          message: result.message,
          status: result.status,
          environment: result.environment
        },
        { status: 400 }
      );
    }

    // 验证成功，检查交易ID是否匹配
    const inAppPurchases = result.receipt?.in_app || [];
    const matchedTransaction = inAppPurchases.find(
      item => item.transaction_id === transactionId
    );

    if (!matchedTransaction) {
      return NextResponse.json(
        { 
          success: false, 
          message: '交易ID不匹配，可能存在异常',
          status: -1
        },
        { status: 400 }
      );
    }

    // TODO: 这里可以添加你自己的业务逻辑
    // 1. 保存订单到数据库
    // 2. 给用户开通对应权益
    // 3. 记录交易日志等
    const orderInfo = {
      orderId: `ORDER_${Date.now()}`,
      transactionId: matchedTransaction.transaction_id,
      originalTransactionId: matchedTransaction.original_transaction_id,
      productId: matchedTransaction.product_id,
      userId: userId || null,
      quantity: parseInt(matchedTransaction.quantity) || 1,
      purchaseDate: new Date(parseInt(matchedTransaction.purchase_date_ms)).toISOString(),
      expiresDate: matchedTransaction.expires_date_ms 
        ? new Date(parseInt(matchedTransaction.expires_date_ms)).toISOString()
        : null,
      environment: result.environment,
      receipt: receipt.substring(0, 100) + '...' // 只保存部分凭证用于调试
    };

    // 返回成功响应
    return NextResponse.json({
      success: true,
      message: '支付验证成功',
      data: {
        orderInfo,
        transactionInfo: {
          transactionId: matchedTransaction.transaction_id,
          productId: matchedTransaction.product_id,
          purchaseDate: matchedTransaction.purchase_date,
          expiresDate: matchedTransaction.expires_date,
          isTrialPeriod: matchedTransaction.is_trial_period === 'true',
          isInIntroOfferPeriod: matchedTransaction.is_in_intro_offer_period === 'true'
        },
        latestReceipt: result.latestReceipt,
        pendingRenewalInfo: result.pendingRenewalInfo
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

/**
 * GET - 查询订单状态（示例）
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('transactionId');

    if (!transactionId) {
      return NextResponse.json(
        { success: false, message: '缺少交易ID' },
        { status: 400 }
      );
    }

    // TODO: 从数据库查询订单状态
    // const order = await db.query('SELECT * FROM orders WHERE transaction_id = ?', [transactionId]);

    return NextResponse.json({
      success: true,
      message: '查询成功',
      data: {
        transactionId,
        status: 'completed', // pending / completed / failed / refunded
        // orderDetails: order
      }
    });

  } catch (error) {
    return NextResponse.json(
      { success: false, message: '查询失败', error: error.message },
      { status: 500 }
    );
  }
}
