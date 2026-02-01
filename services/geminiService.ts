
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
 * Analysiert das Bild des Nutzers für eine Größenempfehlung (Text-basiert).
 */
export async function estimateSizeFromImage(userBase64: string, productName: string): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: APP_CONFIG.TEXT_MODEL,
      contents: {
        parts: [
          { 
            inlineData: { 
              data: getCleanBase64(userBase64), 
              mimeType: getMimeType(userBase64) 
            } 
          },
          { text: `Estimate body size for product "${productName}". Options: [XS, S, M, L, XL, XXL]. Return ONLY the size code.` },
        ],
      },
    });

    const size = response.text?.trim().toUpperCase();
    const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    return validSizes.includes(size || '') ? (size || 'M') : 'M';
  } catch (error) {
    console.error("Size Estimation Error:", error);
    return 'M';
  }
}

/**
 * Erstellt die virtuelle Anprobe (Bild-basiert).
 */
export async function performVirtualTryOn(userBase64: string, productBase64: string, productName: string): Promise<string> {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined") {
    throw new Error("API_KEY fehlt.");
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // WICHTIG: Verwende das IMAGE_MODEL für Bild-Ausgabe
    const response = await ai.models.generateContent({
      model: APP_CONFIG.IMAGE_MODEL,
      contents: {
        parts: [
          { 
            inlineData: { 
              data: getCleanBase64(userBase64), 
              mimeType: getMimeType(userBase64) 
            } 
          },
          { 
            inlineData: { 
              data: getCleanBase64(productBase64), 
              mimeType: getMimeType(productBase64) 
            } 
          },
          { text: `VIRTUAL TRY-ON: Take the outfit from the second image and put it on the person in the first image. Product: ${productName}. The person, pose and background must remain the same as in image 1. Return the generated image.` },
        ],
      }
    });

    // Suche nach dem Bild-Teil in der Antwort
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("Kein Bild generiert. Das Modell hat möglicherweise nur Text geantwortet.");
  } catch (error: any) {
    console.error("Critical Gemini Error:", error);
    
    // Detaillierte Fehlermeldung für den User
    const errorMsg = error.message || "";
    if (errorMsg.includes("400")) {
      throw new Error("Fehler 400: Das Bild konnte nicht verarbeitet werden oder das Modell ist nicht verfügbar. Bitte versuche es mit einem anderen Foto.");
    }
    if (errorMsg.includes("API key not valid")) {
      throw new Error("Der API-Key wird nicht akzeptiert. Bitte prüfe deine Umgebungsvariablen.");
    }
    
    throw new Error("Anproben-Fehler: " + (error.message || "Unbekannter Fehler"));
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
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } else reject(new Error("Canvas Error"));
    };
    img.onerror = () => reject(new Error("Bild-Ladefehler"));
    img.src = `https://images.weserv.nl/?url=${encodeURIComponent(url)}`;
  });
}
