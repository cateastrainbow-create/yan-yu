import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface TravelSolution {
  departureCity: string;
  mode: 'flight' | 'train';
  courseNo: string; // e.g., flight or train number like 'MU1234' or 'G567'
  departureTime: string; // e.g., '09:00'
  arrivalTime: string; // e.g., '12:00'
  cost: number;
}

export interface HubProposal {
  city: string;
  lat: number;
  lng: number;
  fairnessIndex: number;
  travelSolutions: TravelSolution[];
  localGuides: {
    tags: string[];
    foods: string[];
    attractions: string[];
  };
  weather: {
    temp: number;
    description: string;
    clothing: string;
  };
  assemblyPoint: string;
  budgetSummary: {
    total: number;
    perPerson: number;
  };
}

export async function calculateHubs(departureCities: string[]): Promise<HubProposal[]> {
  const prompt = `You are a travel planning assistant. The users are in the following cities: ${departureCities.join(", ")}.
They want to meet in a "Hub" city in China that is fair for everyone.
IMPORTANT: Your ENTIRE response MUST BE IN SIMPLIFIED CHINESE (including descriptions, clothing advice, and city names in Chinese).
Please propose 3 distinct Hub cities in China.
For each city, provide:
1. city name
2. lat and lng coordinates
3. fairnessIndex (a score from 0 to 100 calculated conceptually as: depth of ink wash = f(transport fairness, budget match, time alignment))
4. travelSolutions for EACH departure city to this Hub. To achieve "Synchronized Arrival", you MUST suggest realistic looking flight or train numbers and schedules such that ALL travelers arrive at the hub city within a 1-hour window.
   Provide mode ('flight' or 'train'), courseNo (e.g., 'CA1234' or 'G567'), departureTime (e.g. '09:00'), arrivalTime (e.g. '12:15'), and estimated cost in RMB.
5. localGuides: 3 travel tags, 3 typical foods, 3 must-visit attractions
6. weather: estimated current temperature in Celsius, description, and clothing advice
7. assemblyPoint: a realistic name of a boutique hotel or distinct gathering place in this city.
8. budgetSummary: the total estimated cost for all travelers and average perPerson cost in RMB.

Format the output strictly as JSON following the schema.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            city: { type: Type.STRING },
            lat: { type: Type.NUMBER },
            lng: { type: Type.NUMBER },
            fairnessIndex: { type: Type.NUMBER },
            assemblyPoint: { type: Type.STRING },
            budgetSummary: {
              type: Type.OBJECT,
              properties: {
                total: { type: Type.NUMBER },
                perPerson: { type: Type.NUMBER }
              },
              required: ["total", "perPerson"]
            },
            travelSolutions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  departureCity: { type: Type.STRING },
                  mode: { type: Type.STRING, enum: ['flight', 'train'] },
                  courseNo: { type: Type.STRING },
                  departureTime: { type: Type.STRING },
                  arrivalTime: { type: Type.STRING },
                  cost: { type: Type.NUMBER }
                },
                required: ["departureCity", "mode", "courseNo", "departureTime", "arrivalTime", "cost"]
              }
            },
            localGuides: {
              type: Type.OBJECT,
              properties: {
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                foods: { type: Type.ARRAY, items: { type: Type.STRING } },
                attractions: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["tags", "foods", "attractions"]
            },
            weather: {
              type: Type.OBJECT,
              properties: {
                temp: { type: Type.NUMBER },
                description: { type: Type.STRING },
                clothing: { type: Type.STRING }
              },
              required: ["temp", "description", "clothing"]
            }
          },
          required: ["city", "lat", "lng", "fairnessIndex", "assemblyPoint", "budgetSummary", "travelSolutions", "localGuides", "weather"]
        }
      }
    }
  });

  if (!response.text) {
    throw new Error("No response from AI");
  }

  return JSON.parse(response.text) as HubProposal[];
}

export async function getCityCoordinates(cities: string[]): Promise<{city: string, lat: number, lng: number}[]> {
  const prompt = `Provide the latitude and longitude coordinates for the following cities: ${cities.join(", ")}. Return only the JSON array with city names in Simplified Chinese.`;
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            city: { type: Type.STRING },
            lat: { type: Type.NUMBER },
            lng: { type: Type.NUMBER }
          },
          required: ["city", "lat", "lng"]
        }
      }
    }
  });
  if (!response.text) throw new Error("No coords returned");
  return JSON.parse(response.text);
}
