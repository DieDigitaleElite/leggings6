
import { GoogleGenAI } from "@google/genai";
import { APP_CONFIG } from "../constants";

function getMimeType(dataUrl: string): string {
  if (dataUrl.startsWith('data:')) {
    const match = dataUrl.match(/^data:([^;]+);base64,/);
    return match ? match[1] : "image/png";
  }
  return "image/png";
}

function getCleanBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

/**
 * Nutzt Gemini 3 Flash für Text-Analyse (Größenempfehlung)
 */
export async function estimateSizeFromImage(userBase64: string, productName: string): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: APP_CONFIG.TEXT_MODEL,
      contents: {
        parts: [
          { inlineData: { data: getCleanBase64(userBase64), mimeType: getMimeType(userBase64) } },
          { text: `Analysiere die Person auf dem Bild. Welche Kleidergröße (XS, S, M, L, XL, XXL) passt ihr am besten für das Produkt "${productName}"? Antworte NUR mit dem Code.` }
        ]
      }
    });
    const size = response.text?.trim().toUpperCase() || 'M';
    const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    return validSizes.find(s => size.includes(s)) || 'M';
  } catch (error) {
    console.error("Size Estimation Error:", error);
    return 'M';
  }
}

/**
 * Nutzt Gemini 2.5 Flash Image für die Bild-zu-Bild Bearbeitung (Anprobe)
 * Basierend auf der funktionierenden Legacy-Version der App.
 */
export async function performVirtualTryOn(userBase64: string, productBase64: string, productName: string): Promise<string> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY nicht konfiguriert.");

  const userMimeType = getMimeType(userBase64);
  const productMimeType = getMimeType(productBase64);
  
  const cleanUserBase64 = getCleanBase64(userBase64);
  const cleanProductBase64 = getCleanBase64(productBase64);

  const ai = new GoogleGenAI({ apiKey });
  
  const promptText = `
    CRITICAL TASK: Absolute High-Fidelity Virtual Try-On.
    
    PRODUCT IDENTIFICATION: The product to apply is "${productName}" from the second image.
    
    STRICT DESIGN CONSTRAINTS (ZERO HALLUCINATION POLICY):
    1. NO ADDITIONS: Do NOT add pockets, zippers, buttons, drawstrings, or logos that are not clearly visible in the product image. If the product is seamless/clean, the output MUST be seamless/clean.
    2. SEAM ACCURACY: Replicate the exact seam lines, waist band height, and stitching patterns shown in the product image.
    3. FABRIC INTEGRITY: The texture, opacity, and color saturation must match the product image exactly. 
    4. ANATOMICAL FIT: The clothing must fit the person in the first image perfectly like a second skin, following their leg and torso shape without distorting the product's design.
    
    PRESERVATION RULES:
    - Keep the user's face, hair, hands, feet, and original background 100% identical.
    - Only replace the clothing. Ensure a clean transition at the waist, neck, and ankles.
    
    FINAL CHECK: Compare your generated outfit to the product image. They must be identical in structure and features.
    
    OUTPUT:
    Return ONLY the image. No textual response.
  `;

  try {
    const response = await ai.models.generateContent({
      model: APP_CONFIG.IMAGE_MODEL,
      contents: {
        parts: [
          { inlineData: { data: cleanUserBase64, mimeType: userMimeType } },
          { inlineData: { data: cleanProductBase64, mimeType: productMimeType } },
          { text: promptText },
        ],
      },
      config: {
        temperature: 0.1,
      }
    });

    if (!response || !response.candidates || response.candidates.length === 0) {
      throw new Error("Die KI hat keine Antwort geliefert.");
    }

    const candidate = response.candidates[0];
    
    if (candidate.finishReason === 'SAFETY') {
      throw new Error("Das Foto wurde blockiert. Bitte nutze ein Bild mit neutralerer Pose.");
    }

    let generatedImageUrl: string | null = null;
    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.data) {
          generatedImageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!generatedImageUrl) {
      throw new Error("Fehler 400: Das Bild konnte nicht verarbeitet werden. Bitte versuche es mit einem anderen Foto.");
    }

    return generatedImageUrl;
  } catch (error: any) {
    console.error("Gemini Try-On Error:", error);
    throw new Error(error.message || "Fehler bei der Anprobe. Bitte versuche es erneut.");
  }
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

export async function urlToBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const proxiedUrl = `https://images.weserv.nl/?url=${encodeURIComponent(url)}`;
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Canvas Fail");
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(new Error(`Fehler bei Bildverarbeitung.`));
      }
    };
    img.onerror = () => reject(new Error(`Produktbild konnte nicht geladen werden.`));
    img.src = proxiedUrl;
  });
}
