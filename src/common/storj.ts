import { Upload } from "@aws-sdk/lib-storage";
import { DeleteObjectCommand, ObjectCannedACL } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { HttpException } from "@nestjs/common";
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const GARANT_ACCESS = process.env.AWS_ACCESS_GRANT;
const ENDPOINT = process.env.AWS_S3_ENDPOINT;
const BUCKET = process.env.AWS_BUCKET_NAME;
const REGION = process.env.AWS_REGION;

const debugStorjConfig = () => {
  console.log('=== DEBUG STORJ CONFIG ===');
  console.log('ACCESS_KEY_ID:', ACCESS_KEY_ID ? `${ACCESS_KEY_ID.substring(0, 10)}...` : 'MISSING');
  console.log('SECRET_ACCESS_KEY:', SECRET_ACCESS_KEY ? `${SECRET_ACCESS_KEY.substring(0, 10)}...` : 'MISSING');
  console.log('GARANT_ACCESS:', GARANT_ACCESS ? `${GARANT_ACCESS.substring(0, 20)}...` : 'MISSING');
  console.log('ENDPOINT:', ENDPOINT);
  console.log('BUCKET:', BUCKET);
  console.log('REGION:', REGION);
  console.log('========================');
};

const uploadFileS3 = async (file: Express.Multer.File) => {
  try {
    if (!file) {
      throw new HttpException('Nenhum arquivo foi fornecido', 400);
    }

    debugStorjConfig();

    if (!ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !BUCKET || !ENDPOINT) {
      throw new HttpException('Configurações do Storj incompletas', 500);
    }

    console.log('Iniciando upload do arquivo:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      hasPath: !!file.path,
      hasBuffer: !!file.buffer
    });

    const s3 = new S3Client({
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
      endpoint: ENDPOINT,
      region: REGION || 'us-east-1',
      forcePathStyle: true,
    });

    let fileBuffer: Buffer;
    let key: string;

    const timestamp = Date.now();
    const randomString = uuidv4().substring(0, 8);
    const fileExtension = file.mimetype.includes('pdf') ? 'pdf' : 'png';
    key = `uploads/${timestamp}-${randomString}.${fileExtension}`;

    try {
      if (file.mimetype.includes('pdf')) {
        console.log('Processando arquivo PDF...');
        
        if (file.path && await fs.promises.access(file.path).then(() => true).catch(() => false)) {
          console.log('Lendo PDF do disco:', file.path);
          fileBuffer = await fs.promises.readFile(file.path);
        } else if (file.buffer) {
          console.log('Usando PDF do buffer da memória');
          fileBuffer = file.buffer;
        } else {
          throw new Error('Arquivo PDF não encontrado nem no disco nem na memória');
        }
      } else {
        console.log('Processando arquivo de imagem...');
        
        let inputBuffer: Buffer;
        
        if (file.path && await fs.promises.access(file.path).then(() => true).catch(() => false)) {
          console.log('Lendo imagem do disco:', file.path);
          inputBuffer = await fs.promises.readFile(file.path);
        } else if (file.buffer) {
          console.log('Usando imagem do buffer da memória');
          inputBuffer = file.buffer;
        } else {
          throw new Error('Arquivo de imagem não encontrado nem no disco nem na memória');
        }

        console.log('Comprimindo imagem com Sharp...');
        fileBuffer = await sharp(inputBuffer)
          .png({ 
            quality: 60, 
            compressionLevel: 9,
            progressive: true
          })
          .resize(1920, 1080, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();
        
        console.log(`Imagem processada. Tamanho original: ${inputBuffer.length}, Tamanho final: ${fileBuffer.length}`);
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error('Buffer do arquivo está vazio após processamento');
      }

      let params: any = {
        Bucket: BUCKET,
        Key: key,
        Body: fileBuffer,
        ContentType: file.mimetype.includes('pdf') ? 'application/pdf' : 'image/png',
        Metadata: {
          'original-name': file.originalname || 'unknown',
          'upload-date': new Date().toISOString(),
        }
      };

      console.log('Tentativa 1: Upload sem ACL...', {
        bucket: BUCKET,
        key: key,
        size: fileBuffer.length,
        contentType: params.ContentType
      });

      try {
        const uploaded = await new Upload({
          client: s3,
          params: params,
          partSize: 64 * 1024 * 1024,
          queueSize: 4,
        }).done();

        console.log('Upload concluído com sucesso (sem ACL):', uploaded.Key);

        if (file.path) {
          try {
            await fs.promises.unlink(file.path);
            console.log('Arquivo temporário removido:', file.path);
          } catch (cleanupError) {
            console.warn('Não foi possível remover arquivo temporário:', cleanupError.message);
          }
        }

        return uploaded.Key;

      } catch (uploadError) {
        console.log('Tentativa 1 falhou, tentando com ACL public-read...', uploadError.message);
        
        params.ACL = "public-read" as ObjectCannedACL;
        
        try {
          const uploaded = await new Upload({
            client: s3,
            params: params,
            partSize: 64 * 1024 * 1024,
            queueSize: 4,
          }).done();

          console.log('Upload concluído com sucesso (com ACL public-read):', uploaded.Key);

          if (file.path) {
            try {
              await fs.promises.unlink(file.path);
              console.log('Arquivo temporário removido:', file.path);
            } catch (cleanupError) {
              console.warn('Não foi possível remover arquivo temporário:', cleanupError.message);
            }
          }

          return uploaded.Key;

        } catch (uploadError2) {
          console.log('Tentativa 2 falhou, tentando sem ACL e com bucket-owner-full-control...', uploadError2.message);
          
          params.ACL = "bucket-owner-full-control" as ObjectCannedACL;
          
          try {
            const uploaded = await new Upload({
              client: s3,
              params: params,
              partSize: 64 * 1024 * 1024,
              queueSize: 4,
            }).done();

            console.log('Upload concluído com sucesso (com bucket-owner-full-control):', uploaded.Key);

            if (file.path) {
              try {
                await fs.promises.unlink(file.path);
                console.log('Arquivo temporário removido:', file.path);
              } catch (cleanupError) {
                console.warn('Não foi possível remover arquivo temporário:', cleanupError.message);
              }
            }

            return uploaded.Key;

          } catch (uploadError3) {
            console.error('Todas as tentativas de upload falharam:', uploadError3);
            throw uploadError3;
          }
        }
      }

    } catch (processingError) {
      console.error('Erro ao processar arquivo:', processingError);
      
      if (file.path) {
        try {
          await fs.promises.unlink(file.path);
          console.log('Arquivo temporário removido após erro:', file.path);
        } catch (cleanupError) {
          console.warn('Não foi possível remover arquivo temporário:', cleanupError.message);
        }
      }
      
      throw new HttpException(
        `Erro ao processar arquivo: ${processingError.message}`, 
        400
      );
    }

  } catch (error: any) {
    console.error('Erro geral ao fazer upload do arquivo:', error);
    
    if (error instanceof HttpException) {
      throw error;
    }
    
    throw new HttpException(
      `Erro no upload: ${error.message || 'Erro desconhecido'}`, 
      error.status || 500
    );
  }
};

const testStorjCredentials = async (): Promise<void> => {
  try {
    console.log('=== TESTANDO CREDENCIAIS STORJ ===');
    
    const s3 = new S3Client({
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
      endpoint: ENDPOINT,
      region: REGION || 'us-east-1',
      forcePathStyle: true,
    });

    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      MaxKeys: 1
    }));

    console.log('✅ Credenciais funcionando! Objetos encontrados:', result.KeyCount || 0);
    
  } catch (error: any) {
    console.error('❌ Erro ao testar credenciais:', error.message);
    console.error('Código do erro:', error.Code);
    throw error;
  }
};

const uploadFileFromPath = async (data: { filename: string; path: string; mimetype: string; }): Promise<string> => {
  try {
    if (!data.path || !(await fs.promises.access(data.path).then(() => true).catch(() => false))) {
      throw new HttpException('Arquivo não encontrado no caminho especificado', 400);
    }

    debugStorjConfig();

    console.log('Iniciando upload do arquivo do caminho:', data.path);

    const s3 = new S3Client({
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
      endpoint: ENDPOINT,
      region: REGION || 'us-east-1',
      forcePathStyle: true,
    });

    let fileBuffer: Buffer;
    let key: string;

    const timestamp = Date.now();
    const randomString = uuidv4().substring(0, 8);
    const fileExtension = data.mimetype.includes('pdf') ? 'pdf' : 'png';
    key = `uploads/${timestamp}-${randomString}.${fileExtension}`;

    try {
      const inputBuffer = await fs.promises.readFile(data.path);

      if (data.mimetype.includes('pdf')) {
        console.log('Processando arquivo PDF...');
        fileBuffer = inputBuffer;
      } else {
        console.log('Processando arquivo de imagem...');
        
        fileBuffer = await sharp(inputBuffer)
          .png({ 
            quality: 60, 
            compressionLevel: 9,
            progressive: true
          })
          .resize(1920, 1080, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();
        
        console.log(`Imagem processada. Tamanho original: ${inputBuffer.length}, Tamanho final: ${fileBuffer.length}`);
      }

      const params = {
        Bucket: BUCKET,
        Key: key,
        Body: fileBuffer,
        ContentType: data.mimetype.includes('pdf') ? 'application/pdf' : 'image/png',
        Metadata: {
          'original-name': data.filename || 'unknown',
          'upload-date': new Date().toISOString(),
        }
      };

      console.log('Iniciando upload para Storj...', {
        bucket: BUCKET,
        key: key,
        size: fileBuffer.length,
        contentType: params.ContentType
      });

      const uploaded = await new Upload({
        client: s3,
        params: params,
        partSize: 64 * 1024 * 1024,
        queueSize: 4,
      }).done();

      console.log('Upload concluído com sucesso:', uploaded.Key);

      try {
        await fs.promises.unlink(data.path);
        console.log('Arquivo temporário removido:', data.path);
      } catch (cleanupError) {
        console.warn('Não foi possível remover arquivo temporário:', cleanupError.message);
      }

      return uploaded.Key;

    } catch (processingError) {
      console.error('Erro ao processar arquivo:', processingError);
      
      try {
        await fs.promises.unlink(data.path);
      } catch (cleanupError) {
        console.warn('Não foi possível remover arquivo temporário:', cleanupError.message);
      }
      
      throw new HttpException(
        `Erro ao processar arquivo: ${processingError.message}`, 
        400
      );
    }

  } catch (error: any) {
    console.error('Erro geral ao fazer upload do arquivo:', error);
    
    if (error instanceof HttpException) {
      throw error;
    }
    
    throw new HttpException(
      `Erro no upload: ${error.message || 'Erro desconhecido'}`, 
      error.status || 500
    );
  }
};

const getUrlImageByKey = (key: string): string => {
  if (!key) {
    throw new Error('Key não fornecida para gerar URL');
  }
  
  if (!GARANT_ACCESS || !BUCKET) {
    throw new Error('Configurações do Storj não encontradas');
  }
  
  const url = `https://link.storjshare.io/s/${GARANT_ACCESS}/${BUCKET}/${key}?wrap=0`;
  console.log('URL gerada para a imagem:', url);
  return url;
};

const deleteByKey = async (key: string): Promise<string> => {
  if (!key) {
    throw new HttpException('Key não fornecida para exclusão', 400);
  }

  console.log('Iniciando exclusão do arquivo:', key);

  try {
    const s3 = new S3Client({
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
      endpoint: ENDPOINT,
      region: REGION || 'us-east-1',
      forcePathStyle: true,
    });

    const bucketParams = { 
      Bucket: BUCKET, 
      Key: key 
    };

    await s3.send(new DeleteObjectCommand(bucketParams));
    console.log('Arquivo deletado com sucesso:', key);
    
    return 'deleted';
  } catch (error: any) {
    console.error('Erro ao deletar arquivo:', error);
    throw new HttpException(
      `Erro ao deletar arquivo: ${error.message}`, 
      error.status || 500
    );
  }
};

const validateStorjConfig = (): boolean => {
  const requiredEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 
    'AWS_ACCESS_GRANT',
    'AWS_S3_ENDPOINT',
    'AWS_BUCKET_NAME',
    'AWS_REGION'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('Variáveis de ambiente do Storj não configuradas:', missingVars);
    return false;
  }

  return true;
};

export { 
  uploadFileS3, 
  uploadFileFromPath,
  getUrlImageByKey, 
  deleteByKey, 
  validateStorjConfig, 
  testStorjCredentials,
  debugStorjConfig
};
