// 简化版调用示例
const { callWanxImageGeneration } = require('./run');

async function simpleExample() {
    const result = await callWanxImageGeneration({
        apiKey: 'sk-4e977c2d14fd4f3a822e62322d93158f', // 您的API Key
        prompt: '一只可爱的猫咪在花园里玩耍',
        // imageUrl: 'https://img.alicdn.com/imgextra/i3/O1CN01SfG4J41UYn9WNt4X1_!!6000000002530-49-tps-1696-960.webp',
        // prompt: '参考图中宝宝照片，脸部特征与参考图一致，头戴，身穿，佩戴，置身于，，远景，写实人像摄影，专业儿童写真，柔和自然光，高清细腻肤质，画面干净温暖治愈，配文：""，右下角签名艺术字，不遮挡人物',
        size: '1280*1280',
        prompt: '参考图中宝宝照片，脸部特征与参考图一致，头戴贝雷帽，身穿粉色连衣裙，佩戴围巾，置身于儿童房，双手拍掌，中景，写实人像摄影，专业儿童写真，柔和自然光，高清细腻肤质，画面干净温暖治愈，配文："我的宝贝，爱你"，右下角签名艺术字，不遮挡人物',
        watermark: false,
        n: 2,
    });

    if (result.success) {
        console.log(`成功生成 ${result.imageCount} 张图片`);
        
        // 下载图片示例
        const fs = require('fs');
        const https = require('https');
        
        for (const imageInfo of result.imageUrls) {
            const fileName = `generated-image-${imageInfo.index}.png`;
            const file = fs.createWriteStream(fileName);
            
            https.get(imageInfo.url, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(`图片已保存: ${fileName}`);
                });
            }).on('error', (err) => {
                fs.unlink(fileName);
                console.error(`下载图片失败: ${err.message}`);
            });
        }
    } else {
        console.error('生成失败:', result.error);
    }
}

simpleExample();
