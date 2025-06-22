import { writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import OpenAI from 'openai';
import { VideoPromptGenerator } from "../helper";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

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

    const result = await videoPromptGenerator.generateVideoPrompts(review_images, images, name);

    


     const promises = result.selectedImages.map(async ({ prompt, imageUrl }: { prompt: string, imageUrl: string }) => {
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
    });




logger.warn("Starting ElevenLabs API call");

    const elevenlabs = new ElevenLabsClient({
        apiKey: process.env.ELEVENLABS_API_KEY
    });

    logger.warn("ElevenLabs API call started, created client");
    
    const audio = await elevenlabs.textToSpeech.convert("TX3LPaxmHKxFdv7VOQHJ", {
        text: result.narrationScript,
        modelId: "eleven_flash_v2_5",
        languageCode: "fr" // replace with the language code of the video
    })

    logger.info({
        audio
    }) 

    //@ts-ignore
     await writeFile("audio.mp3", audio);
     

     // stich all videos together 
    //  ffmpeg -i output_0.mp4 -i output_1.mp4 -i output_2.mp4 -i output_3.mp4 -i output_4.mp4 -i output_5.mp4 -i output_6.mp4 -i output_7.mp4 -i output_8.mp4 -i output_9.mp4 -filter_complex "[0:v][1:v][2:v][3:v][4:v][5:v][6:v][7:v][8:v][9:v]concat=n=10:v=1:a=0[outv]" -map "[outv]" merged_output.mp4
     

    // add audio to the video
    // export AUDIO_DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 audio.mp3)
    // ffmpeg -i merged_output.mp4 -i audio.mp3 -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=4[v]" -map "[v]" -map 1:a -t  $AUDIO_DURATION output_new-french.mp4
    

    return NextResponse.json({
        result: "success"
    })
    
}