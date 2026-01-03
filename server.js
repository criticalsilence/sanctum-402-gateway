require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { ethers } = require('ethers');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Base Sepolia USDC Kontrat Adresi
const USDC_CONTRACT_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; 
const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);

// --- 1. MODEL VE FİYAT LİSTESİ (VENICE API ID'LERİ GÜNCELLENDİ) ---
const MODEL_CONFIG = {
    // Frontend'den gelen key -> Backend'deki gerçek Venice ID
    
    // Hızlı Model (Llama 3.2 3B)
    "llama-fast": { 
        price: 0.05, 
        venice_id: "llama-3.2-3b" 
    },
    
    // Zeki Model (Llama 3.3 70B)
    "llama-smart": { 
        price: 0.20, 
        venice_id: "llama-3.3-70b" 
    },
    
    // Sansürsüz Model (Venice Uncensored)
    "uncensored": { 
        price: 0.50, 
        venice_id: "venice-uncensored" 
    },
    
    // Premium Model (Hermes 3 405B)
    "premium-405b": { 
        price: 1.00, 
        venice_id: "hermes-3-llama-3.1-405b" 
    }
};

// --- ÖDEME KONTROLÜ ---
async function verifyPayment(txHash, requiredAmount) {
    console.log(`\n🔍 TX Kontrol: ${txHash}`);
    if (!txHash) return false;
    
    try {
        const tx = await provider.getTransaction(txHash);
        if (!tx) { console.log("❌ Tx Ağda Yok"); return false; }

        if (tx.to.toLowerCase() !== USDC_CONTRACT_ADDRESS.toLowerCase()) {
            console.log("❌ Yanlış Kontrat"); return false;
        }

        const iface = new ethers.Interface(["function transfer(address to, uint amount)"]);
        const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
        
        const toAddress = decoded.args[0];
        const sentAmount = parseFloat(ethers.formatUnits(decoded.args[1], 6));

        if (toAddress.toLowerCase() !== process.env.MERCHANT_WALLET.toLowerCase()) {
            console.log("❌ Alıcı Biz Değiliz"); return false;
        }

        if (sentAmount < requiredAmount) {
            console.log(`❌ Eksik Tutar: ${sentAmount} < ${requiredAmount}`); return false;
        }

        console.log("✅ Ödeme Geçerli.");
        return true;
    } catch (error) {
        console.error("Doğrulama Hatası:", error.message);
        return false;
    }
}

// --- CHAT ENDPOINT ---
app.post('/chat', async (req, res) => {
    const { model, messages, txHash } = req.body;
    
    const selectedModel = MODEL_CONFIG[model];
    if (!selectedModel) {
        return res.status(400).json({ error: "Geçersiz Model Seçimi" });
    }

    const isPaid = await verifyPayment(txHash, selectedModel.price);
    if (!isPaid) {
        return res.status(402).json({
            error: "Payment Required",
            message: `Lütfen ${selectedModel.price} USDC ödeme yapın.`
        });
    }

    try {
        console.log(`🚀 Venice'e soruluyor: ${selectedModel.venice_id}`);
        
        const veniceResponse = await axios.post('https://api.venice.ai/api/v1/chat/completions', {
            model: selectedModel.venice_id,
            messages: messages,
            temperature: 0.7, 
            max_tokens: 2000 
        }, {
            headers: { 'Authorization': `Bearer ${process.env.VENICE_API_KEY}` }
        });
        
        res.json(veniceResponse.data);

    } catch (error) {
        console.error("Venice API Hatası:", error.response?.data || error.message);
        res.status(500).json({ error: "AI Servis Hatası", detail: error.response?.data });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sanctum-402 Hazır: http://localhost:${PORT}`));