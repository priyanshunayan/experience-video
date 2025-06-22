import { writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import OpenAI from 'openai';
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
// import FfmpegCommand from 'fluent-ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import { VideoPromptGenerator } from "../helper";
import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js";

import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'user-service' },
    transports: [
        //
        // - Write all logs with importance level of `error` or higher to `error.log`
        //   (i.e., error, fatal, but not other levels)
        //
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        //
        // - Write all logs with importance level of `info` or higher to `combined.log`
        //   (i.e., fatal, error, warn, and info, but not trace)
        //
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

export const GET = async (request: NextRequest) => {
    const { searchParams } = new URL(request.url);
    const tgid = searchParams.get("tgid");

    if (!tgid) {
        return NextResponse.json({ error: "TGID is required" }, { status: 400 });
    }

    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });


    const headout_url = `https://api.headout.com/api/v6/tour-groups/${tgid}?&language=en&&currency=EUR`

    const review_media = `https://api.headout.com/api/v6/tour-groups/${tgid}/review-medias?language=en&currency=EUR&limit=20`

    const response = await fetch(headout_url);
    const data = await response.json();

    const review_response = await fetch(review_media);

    const review_data = await review_response.json();

    const review_images = review_data.items.filter((review: any) => review.reviewMedias[0].fileSize < 1000000).map((review: any) => review.reviewMedias[0].url);

    logger.info({
        review_images
    })



    const images = data.imageUploads.map((image: any) => image.url);

    const name = data.name;


    const videoPromptGenerator = new VideoPromptGenerator();

    // const result = await videoPromptGenerator.generateVideoPrompts(review_images, images, name);

    


/*     const promises = result.selectedImages.map(async ({ prompt, imageUrl }: { prompt: string, imageUrl: string }) => {
        const input = {
            prompt: prompt,
            start_image_url: imageUrl
        };
        const output = await replicate.run("luma/ray", { input });
        return output;
    }) 


    const outputs = await Promise.all([...promises]);

    outputs.forEach((output, index) => {
        //@ts-ignore
        writeFile(`output_${index}.mp4`, output);
    }) */;




// /* logger.warn("Starting ElevenLabs API call"); */

    const elevenlabs = new ElevenLabsClient({
        apiKey: process.env.ELEVENLABS_API_KEY
    });

    logger.warn("ElevenLabs API call started, created client");
    
    const audio = await elevenlabs.textToSpeech.convert("TX3LPaxmHKxFdv7VOQHJ", {
        text: `La douce lumière du soleil baigne un grand jardin et une statue majestueuse.

Un balayage délicat de la caméra révèle une élégance symétrique et une beauté naturelle.

En traversant des couloirs aux miroirs, des teintes dorées scintillent tout autour.

Panoramique sur l’or et le bleu ornés, avec de douces réflexions.

Un couloir ensoleillé bordé de statues transmet la sérénité de l’histoire.

Un zoom cinématographique révèle un lustre qui brille chaleureusement.

La lumière cinématographique enrichit l’or et les motifs floraux, figés dans le temps.

Une approche douce met en valeur les détails d’une statue dorée.

Des mouvements subtils animent une scène de fontaine vibrante.

Les couleurs vives du jardin brillent doucement sous la lumière naturelle.

Réservez dès maintenant sur Headout en toute simplicité.`,
        modelId: "eleven_flash_v2_5",
        languageCode: "fr"
    })

    logger.info({
        audio
    }) 

    //@ts-ignore
     await writeFile("audio.mp3", audio);
    

    return NextResponse.json({
        result: "success"
    })
    
}