import { PartialType } from '@nestjs/mapped-types';
import { CreateRaydiumDto } from './create-raydium.dto.js';

export class UpdateRaydiumDto extends PartialType(CreateRaydiumDto) {}
