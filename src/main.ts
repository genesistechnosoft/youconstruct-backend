import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ValidationError } from 'class-validator';

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): { field: string; message: string }[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const messages = Object.values(error.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    const childMessages = flattenValidationErrors(error.children ?? [], field);

    return [...messages, ...childMessages];
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const port = config.get<number>('PORT', 3000);
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  const swaggerEnabled = config.get<string>('SWAGGER_ENABLED') === 'true';
  const corsOrigins = config.get<string>('CORS_ORIGINS');

  // app.use(helmet());
  app.use(
    helmet({
      contentSecurityPolicy: swaggerEnabled ? false : undefined,
    }),
  );
  app.setGlobalPrefix(apiPrefix);
  app.enableCors({
    origin: corsOrigins
      ? corsOrigins.split(',').map((origin) => origin.trim())
      : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (errors) =>
        new BadRequestException({
          message: 'Validation failed',
          error: 'VALIDATION_ERROR',
          details: flattenValidationErrors(errors),
        }),
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('YouConstruct API')
      .setDescription('Multi-vendor construction marketplace API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      jsonDocumentUrl: `${apiPrefix}/docs/json`,
    });
    console.log(`📚 Swagger: http://localhost:${port}/${apiPrefix}/docs`);
  }

  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}/${apiPrefix}`);
}
void bootstrap();
