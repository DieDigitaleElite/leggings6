
import { GoogleGenAI } from "@google/genai";
import { APP_CONFIG } from "../constants";

/**
 * Verkleinert und konvertiert ein Bild strikt zu image/jpeg
 */
async function processImageForApi(base64Str: string, maxSize = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxSize) {
          height *= maxSize / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width *= maxSize / height;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Canvas context failed"));
        return;
      }
      // Weißer Hintergrund für Transparenzen (wichtig bei PNG zu JPEG)
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      
      // Strikt als image/jpeg exportieren
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error("Bild konnte nicht verarbeitet werden."));
  });
}

function getCleanBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/(jpeg|png|jpg);base64,/, "");
}

/**
 * Analysiert das Bild für eine Größenempfehlung
 */
export async function estimateSizeFromImage(userBase64: string, productName: string): Promise<string> {
  try {
    const readyImg = await processImageForApi(userBase64, 800);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: APP_CONFIG.TEXT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: getCleanBase64(readyImg), mimeType: "image/jpeg" } },
            { text: `Welche Kleidergröße passt der Person auf dem Bild am besten für das Produkt "${productName}"? Antworte NUR mit dem Code: XS, S, M, L, XL oder XXL.` }
          ]
        }
      ]
    });

    const size = response.text?.trim().toUpperCase() || 'M';
    const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    return validSizes.find(s => size.includes(s)) || 'M';
  } catch (error) {
    console.error("Size Check Error:", error);
    return 'M';
  }
}

/**
 * Erstellt die virtuelle Anprobe
 */
export async function performVirtualTryOn(userBase64: string, productBase64: string, productName: string): Promise<string> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY nicht konfiguriert.");

  try {
    // Bilder vorbereiten
    const [readyUser, readyProduct] = await Promise.all([
      processImageForApi(userBase64, 1024),
      processImageForApi(productBase64, 1024)
    ]);

    const ai = new GoogleGenAI({ apiKey });
    
    // Anfrage mit expliziter Rollenverteilung und klaren Instruktionen
    const response = await ai.models.generateContent({
      model: APP_CONFIG.IMAGE_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: `VIRTUAL TRY-ON: Nimm das Kleidungsstück aus dem zweiten Bild und ziehe es der Person im ersten Bild an. Produkt: ${productName}. 
            WICHTIG: 
            1. Die Person, ihr Gesicht, die Haare und die Pose müssen exakt gleich bleiben.
            2. Der Hintergrund darf sich nicht ändern.
            3. Ersetze nur die Kleidung durch das Set aus Bild 2.
            Gib das resultierende Bild zurück.` },
            { inlineData: { data: getCleanBase64(readyUser), mimeType: "image/jpeg" } },
            { inlineData: { data: getCleanBase64(readyProduct), mimeType: "image/jpeg" } }
          ]
        }
      ]
    });

    // Ergebnis extrahieren
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          return `data:image/jpeg;base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("KI hat kein Bild generiert. Eventuell wurde die Anfrage durch Sicherheitsfilter blockiert.");
  } catch (error: any) {
    console.error("Gemini API Detail Error:", error);
    
    if (error.message?.includes("400")) {
      throw new Error("Anfragefehler (400): Die Bilder konnten nicht kombiniert werden. Versuche es bitte mit einem Foto, auf dem die Person deutlicher zu sehen ist.");
    }
    
    throw new Error(error.message || "Fehler bei der Generierung.");
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
  try {
    // Falls es schon Base64 ist
    if (url.startsWith('data:')) return url;
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        } else reject(new Error("Canvas context missing"));
      };
      img.onerror = () => reject(new Error("Produktbild-Ladefehler"));
      // Verbesserter Proxy-String
      img.src = `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=1024&q=85&output=jpg&n=-1`;
    });
  } catch (e) {
    console.error("URL to Base64 failed", e);
    throw e;
  }
}
