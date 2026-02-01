
import { GoogleGenAI } from "@google/genai";
import { APP_CONFIG } from "../constants";

/**
 * Verkleinert ein Base64-Bild auf eine maximale Breite/Höhe, um API-Limits (Fehler 400) zu vermeiden.
 */
async function resizeImage(base64Str: string, maxWidth = 1024, maxHeight = 1024): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8)); // JPEG mit 80% Qualität spart massiv Platz
    };
  });
}

function getMimeType(dataUrl: string): string {
  if (dataUrl.startsWith('data:')) {
    const match = dataUrl.match(/^data:([^;]+);base64,/);
    return match ? match[1] : "image/jpeg";
  }
  return "image/jpeg";
}

function getCleanBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

/**
 * Analysiert das Bild des Nutzers für eine Größenempfehlung.
 */
export async function estimateSizeFromImage(userBase64: string, productName: string): Promise<string> {
  try {
    const resizedUserImg = await resizeImage(userBase64, 800, 800);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: APP_CONFIG.TEXT_MODEL,
      contents: {
        parts: [
          { 
            inlineData: { 
              data: getCleanBase64(resizedUserImg), 
              mimeType: getMimeType(resizedUserImg) 
            } 
          },
          { text: `Analyze the person's body in the image. What clothing size would fit them best for the product "${productName}"? Options: [XS, S, M, L, XL, XXL]. Return ONLY the size code (e.g., "M").` },
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
 * Erstellt die virtuelle Anprobe.
 */
export async function performVirtualTryOn(userBase64: string, productBase64: string, productName: string): Promise<string> {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined") {
    throw new Error("API_KEY fehlt in der Umgebung.");
  }

  try {
    // Beide Bilder verkleinern, um Payload-Limits zu unterschreiten
    const [resizedUser, resizedProduct] = await Promise.all([
      resizeImage(userBase64, 1024, 1024),
      resizeImage(productBase64, 800, 800)
    ]);

    const ai = new GoogleGenAI({ apiKey });
    
    const response = await ai.models.generateContent({
      model: APP_CONFIG.IMAGE_MODEL,
      contents: {
        parts: [
          { 
            inlineData: { 
              data: getCleanBase64(resizedUser), 
              mimeType: getMimeType(resizedUser) 
            } 
          },
          { 
            inlineData: { 
              data: getCleanBase64(resizedProduct), 
              mimeType: getMimeType(resizedProduct) 
            } 
          },
          { text: `TASK: Virtual Try-On. Dress the person in the first image with the clothing set from the second image (${productName}). Keep the person, their face, hair, pose, and the background exactly as in the first image. Only replace the clothing. Return the edited image.` },
        ],
      }
    });

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("Das Modell hat kein Bild zurückgegeben. Evtl. wurde die Anfrage aus Sicherheitsgründen gefiltert.");
  } catch (error: any) {
    console.error("Gemini Try-On Error:", error);
    
    if (error.message?.includes("400")) {
      throw new Error("Das Bild ist zu groß oder konnte nicht verarbeitet werden. Bitte versuche es mit einem kleineren Foto oder einem anderen Dateiformat.");
    }
    
    throw new Error(error.message || "Fehler bei der KI-Anprobe.");
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
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } else reject(new Error("Canvas Error"));
    };
    img.onerror = () => reject(new Error("Produktbild konnte nicht geladen werden."));
    // Proxy verwenden um CORS Probleme zu vermeiden
    img.src = `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=800&output=jpg`;
  });
}
